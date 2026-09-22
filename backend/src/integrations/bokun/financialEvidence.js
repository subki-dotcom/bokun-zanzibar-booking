const crypto = require("crypto");
const { Decimal, decimalString, normalizeCurrency } = require("../../utils/money");
const defaultClient = require("./bokun.client");

const V2_PREFIX = "/restapi/v2.0";
const INVOICE_TYPES = Object.freeze([
  "CustomerInvoice",
  "AffiliateInvoice",
  "AgentInvoice",
  "SellerInvoice"
]);
const COMMISSION_SOURCES = Object.freeze([
  "BOKUN_MARKETPLACE_CONTRACT",
  "BOKUN_AGENT_INVOICE",
  "BOKUN_AFFILIATE_INVOICE",
  "BOKUN_SELLER_INVOICE",
  "OTA_STATEMENT",
  "MANUAL_APPROVED"
]);

const token = (value) => String(value || "").trim();
const upper = (value) => token(value).toUpperCase();

const amountString = (value, field = "amount") => {
  if (value === null || value === undefined || value === "") return null;
  try {
    return decimalString(value, { field });
  } catch (error) {
    return null;
  }
};

const firstValue = (object, paths = []) => {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => current?.[key], object);
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
};

const rowsFrom = (payload, keys) => {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return payload ? [payload] : [];
};

const normalizeInvoiceType = (value) => {
  const raw = token(value);
  const match = INVOICE_TYPES.find((type) => type.toUpperCase() === raw.toUpperCase());
  return match || "UNKNOWN";
};

const normalizeInvoiceEvidence = (payload) => rowsFrom(payload, ["invoices", "items", "results", "data"]).map((raw) => ({
  type: normalizeInvoiceType(raw.type || raw.invoiceType || raw.kind || raw.name),
  invoiceId: token(raw.id || raw.invoiceId || raw.reference),
  amount: amountString(firstValue(raw, ["totalAmount", "total", "amount", "totalAsMoney.amount"]), "invoice.amount"),
  currency: normalizeCurrency(firstValue(raw, ["currency", "totalAsMoney.currency", "amountAsMoney.currency"])),
  status: upper(raw.status || raw.paymentStatus),
  raw
}));

const normalizeSellerInvoiceEvidence = (payload, bookingId = "") => {
  const rows = [];
  const sellerInvoices = payload?.sellerInvoices;
  if (!sellerInvoices || typeof sellerInvoices !== "object") return rows;

  Object.values(sellerInvoices).forEach((container) => {
    const invoice = container?.activeSellerInvoice || container?.sellerInvoice || null;
    if (!invoice || typeof invoice !== "object") return;
    const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
    const commissionLines = lineItems.filter((line) => line.commissionAmount !== undefined && line.commissionAmount !== null && line.commissionAmount !== "");
    const grossBasisAmount = lineItems.reduce(
      (sum, line) => sum.plus(new Decimal(String(line.unitPrice || 0)).times(String(line.quantity || 0))),
      new Decimal(0)
    );
    const currency = normalizeCurrency(invoice.currency);
    rows.push({
      type: "SellerInvoice",
      source: "BOKUN_SELLER_INVOICE",
      invoiceId: token(invoice.id),
      currency,
      grossBasisAmount: grossBasisAmount.toFixed(),
      commissionPercentage: amountString(
        lineItems.find((line) => line.commissionPercentage !== undefined)?.commissionPercentage,
        "sellerInvoice.commissionPercentage"
      ),
      commissionAmount: amountString(
        commissionLines.length
          ? commissionLines.reduce((sum, line) => sum.plus(new Decimal(String(line.commissionAmount))), new Decimal(0))
          : null,
        "sellerInvoice.commissionAmount"
      ),
      sellerInvoiceTotal: amountString(invoice.total, "sellerInvoice.total"),
      issuerVendorId: token(invoice.issuerVendorId),
      recipientVendorId: token(invoice.recipientVendorId),
      bookingId: token(payload.bookingId || bookingId),
      lineItems: lineItems.map((line) => ({
        ref: token(line.ref),
        title: token(line.title),
        quantity: line.quantity,
        unitPrice: amountString(line.unitPrice, "sellerInvoice.unitPrice"),
        total: amountString(line.total, "sellerInvoice.lineTotal"),
        commissionPercentage: amountString(line.commissionPercentage, "sellerInvoice.commissionPercentage"),
        commissionAmount: amountString(line.commissionAmount, "sellerInvoice.commissionAmount"),
        pricingCategoryId: token(line.pricingCategoryId)
      })),
      status: upper(invoice.status),
      issued: invoice.issued || null,
      raw: invoice
    });
  });
  return rows;
};

const normalizePaymentEvidence = (payload) => rowsFrom(payload, ["payments", "items", "results", "data"]).map((raw) => ({
  paymentId: token(raw.id || raw.paymentId || raw.transactionId || raw.reference),
  amount: amountString(firstValue(raw, ["amount", "totalAmount", "amountAsMoney.amount"]), "payment.amount"),
  currency: normalizeCurrency(firstValue(raw, ["currency", "amountAsMoney.currency"])),
  status: upper(raw.status || raw.paymentStatus),
  method: token(raw.paymentMethod || raw.paymentType || raw.type),
  reference: token(raw.transactionId || raw.reference || raw.id),
  raw
}));

const normalizeAuditEvidence = (payload) => rowsFrom(payload, ["auditRecords", "records", "items", "results", "data"]).map((raw) => ({
  auditId: token(raw.id || raw.auditRecordId || raw.reference),
  action: token(raw.action || raw.event || raw.type),
  occurredAt: raw.occurredAt || raw.createdAt || raw.timestamp || null,
  raw
}));

const normalizeMarketplaceEvidence = ({ contract = null, commission = null } = {}) => ({
  marketplaceContractId: token(contract?.id || contract?.contractId),
  marketplaceResellerId: token(contract?.resellerId || contract?.reseller?.id || contract?.agentId),
  relationship: upper(contract?.relationship || contract?.checkoutType || contract?.type),
  commission: commission ? {
    amount: amountString(firstValue(commission, ["amount", "commission", "commissionAmount", "value"]), "commission.amount"),
    currency: normalizeCurrency(firstValue(commission, ["currency", "commissionCurrency", "amountAsMoney.currency"])),
    source: "BOKUN_MARKETPLACE_CONTRACT",
    raw: commission
  } : null,
  contractRaw: contract,
  commissionRaw: commission
});

const normalizeBokunFinancialEvidence = ({
  booking = {},
  invoices = null,
  payments = null,
  auditRecords = null,
  marketplace = {}
} = {}) => {
  const root = booking?.booking || booking || {};
  const grossAmount = amountString(firstValue(root, ["totalPrice", "total", "amount", "pricingSnapshot.finalPayable", "customerInvoice.totalAsMoney.amount"]), "grossAmount");
  const grossCurrency = normalizeCurrency(firstValue(root, ["currency", "transactionCurrency", "bookingPaymentCurrency", "customerInvoice.totalAsMoney.currency", "invoice.currency"]));
  const customerPaidAmount = amountString(firstValue(root, ["totalPaid", "paidAmount", "bookingPaymentReportedAmount", "bookingPaymentEvidence.reportedPaidAmount", "customerInvoice.paidAmount"]), "customerPaidAmount");
  const paymentCurrency = normalizeCurrency(firstValue(root, ["currency", "transactionCurrency", "bookingPaymentCurrency", "customerInvoice.currency", "customerPayments.0.currency"]));
  const paymentStatus = upper(root.paymentStatus || root.paymentType);
  const paymentMethod = token(root.paymentMethod || root.paidType || root.paymentType);
  const embeddedInvoices = root.invoice ? normalizeInvoiceEvidence({ invoices: [root.invoice] }) : [];
  const embeddedPayments = Array.isArray(root.customerPayments) ? normalizePaymentEvidence({ payments: root.customerPayments }) : [];
  const sellerInvoiceEvidence = invoices ? normalizeSellerInvoiceEvidence(invoices, root.bookingId || booking.bokunBookingId) : [];
  const genericInvoiceEvidence = invoices === null ? embeddedInvoices : normalizeInvoiceEvidence(invoices);
  const invoiceEvidence = sellerInvoiceEvidence.length ? sellerInvoiceEvidence : (genericInvoiceEvidence.length ? genericInvoiceEvidence : embeddedInvoices);
  const paymentEvidence = payments === null ? embeddedPayments : (normalizePaymentEvidence(payments).length ? normalizePaymentEvidence(payments) : embeddedPayments);
  const auditEvidence = auditRecords === null ? [] : normalizeAuditEvidence(auditRecords);
  const commission = marketplace.commission || null;
  const sellerInvoice = sellerInvoiceEvidence[0] || null;
  const evidenceConflicts = [];

  const invoiceCurrencies = new Set(invoiceEvidence.map((row) => row.currency).filter(Boolean));
  if (grossCurrency && invoiceCurrencies.size && !invoiceCurrencies.has(grossCurrency)) evidenceConflicts.push("INVOICE_CURRENCY_MISMATCH");
  if (paymentCurrency && grossCurrency && paymentCurrency !== grossCurrency) evidenceConflicts.push("PAYMENT_CURRENCY_MISMATCH");
  if (commission?.currency && grossCurrency && commission.currency !== grossCurrency) evidenceConflicts.push("COMMISSION_CURRENCY_MISMATCH");
  if (sellerInvoice?.currency && grossCurrency && sellerInvoice.currency !== grossCurrency) evidenceConflicts.push("SELLER_INVOICE_CURRENCY_MISMATCH");

  const evidenceStatus = evidenceConflicts.length || (!grossAmount && !invoiceEvidence.length && !paymentEvidence.length)
    ? "NEEDS_REVIEW"
    : "VERIFIED";

  return {
    bookingId: token(root.bookingId || root.id || booking.bokunBookingId),
    confirmationCode: token(root.confirmationCode || root.bookingReference || booking.confirmationCode),
    experienceId: token(root.experienceId || root.productId || root.bokunProductId || root.activityBookings?.[0]?.productId),
    grossAmount,
    grossCurrency,
    currency: grossCurrency,
    customerPaidAmount,
    reportedPaidAmount: customerPaidAmount,
    paymentCurrency,
    paymentStatus,
    paymentMethod,
    invoiceEvidence,
    paymentEvidence,
    auditEvidence,
    marketplaceContractId: marketplace.marketplaceContractId || "",
    marketplaceResellerId: marketplace.marketplaceResellerId || "",
    marketplaceRelationship: marketplace.relationship || "",
    otaCommissionAmount: commission?.amount || sellerInvoice?.commissionAmount || null,
    otaCommissionCurrency: commission?.currency || sellerInvoice?.currency || "",
    otaCommissionSource: commission?.source || (sellerInvoice ? "BOKUN_SELLER_INVOICE" : ""),
    otaCommissionStatus: sellerInvoice?.commissionAmount !== null && sellerInvoice?.commissionAmount !== undefined ? "VERIFIED" : "NEEDS_REVIEW",
    sellerInvoiceEvidence: sellerInvoice,
    expectedSellerInvoiceAmount: sellerInvoice?.sellerInvoiceTotal || null,
    expectedSellerInvoiceCurrency: sellerInvoice?.currency || "",
    expectedSellerInvoiceSource: sellerInvoice ? "BOKUN_SELLER_INVOICE" : "",
    expectedNetReceivable: null,
    settlementAmount: null,
    settlementCurrency: "",
    settlementEvidence: null,
    retrievedAt: new Date().toISOString(),
    evidenceFetchedAt: new Date().toISOString(),
    evidenceStatus,
    status: evidenceStatus,
    evidenceConflicts,
    evidenceHash: crypto.createHash("sha256").update(JSON.stringify(invoices || {})).digest("hex"),
    raw: { booking, invoices, payments, auditRecords, marketplace }
  };
};

const requireIdentifier = (value, name) => {
  const identifier = token(value);
  if (!identifier) {
    const error = new TypeError(`${name} is required for Bokun financial evidence lookup`);
    error.code = `BOKUN_${name.toUpperCase()}_REQUIRED`;
    throw error;
  }
  return encodeURIComponent(identifier);
};

const createBokunFinancialEvidenceClient = ({ client = defaultClient } = {}) => {
  const get = (path, requestId = "") => client.request({ method: "get", path, requestId });
  const safeGet = async (path, requestId = "") => {
    try {
      return { ok: true, status: "2xx", data: await get(path, requestId) };
    } catch (error) {
      return { ok: false, status: error.statusCode || null, code: error.code || "BOKUN_REQUEST_FAILED", message: error.message || "Bokun request failed" };
    }
  };

  return {
    getBookingDetail: ({ bookingId, confirmationCode = "", requestId = "" } = {}) =>
      get(`/booking.json/booking/${requireIdentifier(confirmationCode || bookingId, "bookingId")}`, requestId),
    getBookingInvoices: ({ bookingId, requestId = "" } = {}) =>
      get(`${V2_PREFIX}/booking/${requireIdentifier(bookingId, "bookingId")}/invoices?invoiceType=SELLER`, requestId),
    getBookingPayments: ({ bookingId, requestId = "" } = {}) =>
      get(`${V2_PREFIX}/booking/${requireIdentifier(bookingId, "bookingId")}/payments`, requestId),
    getBookingAuditRecords: ({ bookingId, requestId = "" } = {}) =>
      get(`${V2_PREFIX}/booking/${requireIdentifier(bookingId, "bookingId")}/audit-records`, requestId),
    getMarketplaceContract: ({ contractId, requestId = "" } = {}) =>
      get(`${V2_PREFIX}/marketplace/contract/${requireIdentifier(contractId, "contractId")}`, requestId),
    getMarketplaceCommission: ({ contractId, experienceId, requestId = "" } = {}) =>
      get(`${V2_PREFIX}/marketplace/contract/${requireIdentifier(contractId, "contractId")}/experience/${requireIdentifier(experienceId, "experienceId")}/commission`, requestId),
    fetchForBooking: async ({ booking, bookingDetail = null, contractId = "", experienceId = "", requestId = "" } = {}) => {
      const bookingId = requireIdentifier(booking?.bokunBookingId || booking?.bookingId || booking?.id, "bookingId");
      const [invoiceResult, paymentResult, auditResult] = await Promise.all([
        safeGet(`${V2_PREFIX}/booking/${bookingId}/invoices?invoiceType=SELLER`, requestId),
        safeGet(`${V2_PREFIX}/booking/${bookingId}/payments`, requestId),
        safeGet(`${V2_PREFIX}/booking/${bookingId}/audit-records`, requestId)
      ]);
      let marketplace = {};
      let marketplaceStatus = {};
      if (token(contractId) && token(experienceId)) {
        const contractResult = await safeGet(`${V2_PREFIX}/marketplace/contract/${requireIdentifier(contractId, "contractId")}`, requestId);
        const commissionResult = await safeGet(`${V2_PREFIX}/marketplace/contract/${requireIdentifier(contractId, "contractId")}/experience/${requireIdentifier(experienceId, "experienceId")}/commission`, requestId);
        marketplace = normalizeMarketplaceEvidence({ contract: contractResult.data, commission: commissionResult.data });
        marketplaceStatus = {
          contract: { status: contractResult.status, code: contractResult.code || "" },
          commission: { status: commissionResult.status, code: commissionResult.code || "" }
        };
      }
      const evidence = normalizeBokunFinancialEvidence({
        booking: bookingDetail || booking,
        invoices: invoiceResult.ok ? invoiceResult.data : null,
        payments: paymentResult.ok ? paymentResult.data : null,
        auditRecords: auditResult.ok ? auditResult.data : null,
        marketplace
      });
      return {
        ...evidence,
        financialEndpointStatus: {
          invoices: { status: invoiceResult.status, code: invoiceResult.code || "" },
          payments: { status: paymentResult.status, code: paymentResult.code || "" },
          auditRecords: { status: auditResult.status, code: auditResult.code || "" },
          marketplace: marketplaceStatus
        }
      };
    }
  };
};

module.exports = {
  COMMISSION_SOURCES,
  INVOICE_TYPES,
  createBokunFinancialEvidenceClient,
  normalizeAuditEvidence,
  normalizeBokunFinancialEvidence,
  normalizeInvoiceEvidence,
  normalizeSellerInvoiceEvidence,
  normalizeInvoiceType,
  normalizeMarketplaceEvidence,
  normalizePaymentEvidence
};
