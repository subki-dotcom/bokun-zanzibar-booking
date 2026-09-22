const { Decimal, decimalString } = require("../../utils/money");

const STATUS = Object.freeze({
  MATCHED: "MATCHED",
  MISSING_COMMISSION: "MISSING_COMMISSION",
  MISSING_INVOICE: "MISSING_INVOICE",
  MISSING_PAYMENT_EVIDENCE: "MISSING_PAYMENT_EVIDENCE",
  MISSING_SETTLEMENT: "MISSING_SETTLEMENT",
  AMOUNT_MISMATCH: "AMOUNT_MISMATCH",
  CURRENCY_MISMATCH: "CURRENCY_MISMATCH",
  CONFLICTING_EVIDENCE: "CONFLICTING_EVIDENCE",
  INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
  NEEDS_REVIEW: "NEEDS_REVIEW"
});

const OTA_CHANNELS = new Set(["VIATOR", "GETYOURGUIDE", "BOKUN_MARKETPLACE", "TOURHQ", "AIRBNB"]);
const token = (value) => String(value || "").trim();
const upper = (value) => token(value).toUpperCase();
const isInternalAgent = (booking = {}) => Boolean(booking.agentId) || upper(booking.sourceChannel) === "AGENT_PORTAL";
const asDecimal = (value) => new Decimal(value === null || value === undefined || value === "" ? 0 : String(value));
const money = (value) => decimalString(asDecimal(value));

const classifyTransaction = ({ booking = {}, evidence = {} } = {}) => {
  if (isInternalAgent(booking)) return "INTERNAL_RISER_AGENT";
  const relationship = upper(evidence.marketplaceRelationship || evidence.relationship);
  if (relationship === "AFFILIATE") return "OTA_AFFILIATE";
  if (relationship === "RESELLER") return "OTA_RESELLER";
  if (upper(booking.salesChannel) === "DIRECT_WEBSITE") return "DIRECT";
  if (OTA_CHANNELS.has(upper(booking.salesChannel))) return "UNKNOWN";
  return "UNKNOWN";
};

const commissionSourceAllowed = (source) => new Set([
  "BOKUN_MARKETPLACE_CONTRACT",
  "BOKUN_AGENT_INVOICE",
  "BOKUN_AFFILIATE_INVOICE",
  "BOKUN_SELLER_INVOICE",
  "OTA_STATEMENT",
  "MANUAL_APPROVED"
]).has(upper(source));

const reconcileBokunFinancialEvidence = ({ booking = {}, evidence = {} } = {}) => {
  const classification = classifyTransaction({ booking, evidence });
  const reasons = [];
  if (evidence.evidenceConflicts?.length) reasons.push(STATUS.CONFLICTING_EVIDENCE);
  if (!evidence.grossAmount || !evidence.grossCurrency) reasons.push(STATUS.INSUFFICIENT_EVIDENCE);
  if (evidence.invoiceEvidence && evidence.invoiceEvidence.length === 0) reasons.push(STATUS.MISSING_INVOICE);
  if (evidence.paymentEvidence && evidence.paymentEvidence.length === 0 && !evidence.customerPaidAmount) reasons.push(STATUS.MISSING_PAYMENT_EVIDENCE);

  const isOta = classification === "OTA_AFFILIATE" || classification === "OTA_RESELLER" || OTA_CHANNELS.has(upper(booking.salesChannel));
  const commissionProven = commissionSourceAllowed(evidence.otaCommissionSource) && evidence.otaCommissionAmount !== null;
  if (isOta && classification !== "INTERNAL_RISER_AGENT" && !commissionProven) reasons.push(STATUS.MISSING_COMMISSION);
  if (isOta && classification !== "INTERNAL_RISER_AGENT" && !evidence.settlementEvidence) reasons.push(STATUS.MISSING_SETTLEMENT);

  if (evidence.grossCurrency && evidence.otaCommissionCurrency && evidence.grossCurrency !== evidence.otaCommissionCurrency) reasons.push(STATUS.CURRENCY_MISMATCH);
  if (evidence.grossCurrency && evidence.expectedSellerInvoiceCurrency && evidence.grossCurrency !== evidence.expectedSellerInvoiceCurrency) reasons.push(STATUS.CURRENCY_MISMATCH);

  let expectedNetReceivable = null;
  if (evidence.expectedSellerInvoiceAmount !== null && evidence.expectedSellerInvoiceAmount !== undefined) {
    expectedNetReceivable = money(evidence.expectedSellerInvoiceAmount);
  } else if (classification === "OTA_RESELLER" && commissionProven && evidence.grossCurrency === evidence.otaCommissionCurrency) {
    expectedNetReceivable = money(asDecimal(evidence.grossAmount).minus(asDecimal(evidence.otaCommissionAmount)));
    if (evidence.expectedNetReceivable !== null && evidence.expectedNetReceivable !== undefined && money(evidence.expectedNetReceivable) !== expectedNetReceivable) {
      reasons.push(STATUS.AMOUNT_MISMATCH);
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  const status = uniqueReasons.length
    ? (uniqueReasons.includes(STATUS.CURRENCY_MISMATCH) ? STATUS.CURRENCY_MISMATCH : (uniqueReasons.includes(STATUS.AMOUNT_MISMATCH) ? STATUS.AMOUNT_MISMATCH : STATUS.NEEDS_REVIEW))
    : STATUS.MATCHED;

  return {
    status,
    classification,
    reasons: uniqueReasons,
    expectedNetReceivable,
    otaCommissionStatus: commissionProven ? "VERIFIED" : (isOta && classification !== "INTERNAL_RISER_AGENT" ? "NEEDS_REVIEW" : "NOT_APPLICABLE"),
    settlementStatus: evidence.settlementEvidence ? "AVAILABLE" : (isOta ? "NEEDS_REVIEW" : "NOT_APPLICABLE"),
    evidenceStatus: evidence.evidenceStatus || "NEEDS_REVIEW"
  };
};

const buildAccountingPreview = ({ booking = {}, evidence = {}, reconciliation = reconcileBokunFinancialEvidence({ booking, evidence }) } = {}) => {
  if (reconciliation.status !== STATUS.MATCHED) {
    const sellerInvoice = evidence.sellerInvoiceEvidence;
    return {
      status: reconciliation.status,
      classification: reconciliation.classification,
      components: sellerInvoice ? [{
        account: "OTA_COMMISSION_EXPENSE",
        direction: "DEBIT",
        amount: money(sellerInvoice.commissionAmount),
        currency: sellerInvoice.currency,
        source: "BOKUN_SELLER_INVOICE"
      }] : [],
      evidence: sellerInvoice ? {
        otaCommissionStatus: "VERIFIED",
        otaCommissionSource: "BOKUN_SELLER_INVOICE",
        otaCommissionAmount: sellerInvoice.commissionAmount,
        otaCommissionCurrency: sellerInvoice.currency,
        sellerInvoiceGrossBasisAmount: sellerInvoice.grossBasisAmount,
        sellerInvoiceCurrency: sellerInvoice.currency,
        commissionPercentage: sellerInvoice.commissionPercentage,
        expectedSellerInvoiceAmount: sellerInvoice.sellerInvoiceTotal,
        expectedSellerInvoiceCurrency: sellerInvoice.currency,
        settlementStatus: reconciliation.settlementStatus,
        fxStatus: reconciliation.reasons.includes(STATUS.CURRENCY_MISMATCH) ? "NEEDS_REVIEW" : "VERIFIED"
      } : null,
      reconciliation
    };
  }

  const gross = money(evidence.grossAmount);
  const components = [{
    account: "TOUR_REVENUE",
    direction: "CREDIT",
    amount: gross,
    currency: evidence.grossCurrency,
    source: "BOKUN_BOOKING_EVIDENCE"
  }];

  if (reconciliation.classification === "OTA_RESELLER") {
    components.unshift({
      account: "ACCOUNTS_RECEIVABLE",
      direction: "DEBIT",
      amount: reconciliation.expectedNetReceivable,
      currency: evidence.grossCurrency,
      source: "RECONCILED_BOKUN_EVIDENCE"
    });
    components.splice(1, 0, {
      account: "OTA_COMMISSION_EXPENSE",
      direction: "DEBIT",
      amount: money(evidence.otaCommissionAmount),
      currency: evidence.otaCommissionCurrency,
      source: evidence.otaCommissionSource
    });
  }

  return { status: "PREVIEW", classification: reconciliation.classification, components, reconciliation };
};

const buildStoredBokunFinancialPreview = ({ booking = {} } = {}) => {
  const stored = booking.bokunFinancialEvidence || {};
  const evidence = {
    ...stored,
    grossAmount: stored.grossAmount === null || stored.grossAmount === undefined ? null : String(stored.grossAmount),
    grossCurrency: stored.grossCurrency || stored.currency || "",
    customerPaidAmount: stored.customerPaidAmount ?? stored.reportedPaidAmount ?? null,
    marketplaceRelationship: stored.marketplaceRelationship || "",
    evidenceStatus: stored.evidenceStatus || stored.status || "NEEDS_REVIEW",
    invoiceEvidence: Array.isArray(stored.invoiceEvidence) ? stored.invoiceEvidence : [],
    paymentEvidence: Array.isArray(stored.paymentEvidence) ? stored.paymentEvidence : []
    ,sellerInvoiceEvidence: stored.sellerInvoiceEvidence || null,
    expectedSellerInvoiceAmount: stored.expectedSellerInvoiceAmount ?? null,
    expectedSellerInvoiceCurrency: stored.expectedSellerInvoiceCurrency || ""
  };
  const reconciliation = reconcileBokunFinancialEvidence({ booking, evidence });
  return buildAccountingPreview({ booking, evidence, reconciliation });
};

module.exports = {
  STATUS,
  buildAccountingPreview,
  buildStoredBokunFinancialPreview,
  classifyTransaction,
  reconcileBokunFinancialEvidence,
  __testables: { commissionSourceAllowed, isInternalAgent, money }
};
