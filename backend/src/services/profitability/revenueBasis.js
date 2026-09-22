const { decimalString, normalizeCurrency } = require("../../utils/money");

const STATUS = Object.freeze({
  VERIFIED: "VERIFIED",
  UNKNOWN: "UNKNOWN",
  NEEDS_REVIEW_FX: "NEEDS_REVIEW_FX"
});

const token = (value) => String(value || "").trim();
const upper = (value) => token(value).toUpperCase();
const amount = (value) => {
  if (value === null || value === undefined || value === "") return null;
  try {
    const normalized = decimalString(value);
    return normalized.startsWith("-") ? null : normalized;
  } catch (error) {
    return null;
  }
};

const resolveVerifiedSupplierRevenueBasis = ({ booking = {}, evidence = null, fallbackAmount = null, fallbackCurrency = "" } = {}) => {
  const source = evidence || booking.bokunFinancialEvidence || {};
  const channel = upper(booking.salesChannel || booking.sourceChannel);
  const sellerInvoice = source.sellerInvoiceEvidence || {};
  const supplierNetAmount = amount(
    source.supplierNetAmount ??
      source.sellerInvoiceTotal ??
      sellerInvoice.sellerInvoiceTotal ??
      source.expectedSellerInvoiceAmount ??
      source.amountDue
  );
  const supplierCurrency = normalizeCurrency(
    source.supplierNetCurrency ||
      source.sellerInvoiceCurrency ||
      sellerInvoice.currency ||
      source.expectedSellerInvoiceCurrency ||
      source.currency
  );
  const verifiedBokun = source.source === "BOKUN" && source.status === "VERIFIED";

  if (verifiedBokun && supplierNetAmount !== null && supplierCurrency && ["GETYOURGUIDE", "GET_YOUR_GUIDE", "GYG", "BOKUN_MARKETPLACE", "MARKETPLACE"].includes(channel)) {
    return {
      amount: supplierNetAmount,
      currency: supplierCurrency,
      source: "BOKUN_MARKETPLACE_SELLER_INVOICE_NET",
      status: STATUS.VERIFIED,
      reconciliationStatus: source.reconciliationStatus || "UNRECONCILED"
    };
  }

  if (verifiedBokun && channel === "VIATOR") {
    if (supplierNetAmount !== null && supplierCurrency) {
      return {
        amount: supplierNetAmount,
        currency: supplierCurrency,
        source: "BOKUN_VIATOR_SUPPLIER_AMOUNT",
        status: STATUS.VERIFIED,
        reconciliationStatus: source.reconciliationStatus || "UNRECONCILED"
      };
    }
  }

  if (["DIRECT_WEBSITE", "WEBSITE", "BOKUN", "BOKUN_DIRECT"].includes(channel)) {
    const directAmount = amount(booking.pricingSnapshot?.finalPayable);
    const directCurrency = normalizeCurrency(booking.pricingSnapshot?.currency || booking.currency);
    if (directAmount !== null && directCurrency) {
      return {
        amount: directAmount,
        currency: directCurrency,
        source: "DIRECT_BOOKING_PRICING_SNAPSHOT_FINAL_PAYABLE",
        status: STATUS.VERIFIED,
        reconciliationStatus: "NOT_APPLICABLE"
      };
    }
  }

  return {
    amount: null,
    currency: "",
    source: "",
    status: STATUS.UNKNOWN,
    reconciliationStatus: source.reconciliationStatus || "UNRECONCILED"
  };
};

const applyRevenueCostCurrencyCheck = ({ revenueBasis, costCurrency = "" } = {}) => {
  if (!revenueBasis || revenueBasis.status !== STATUS.VERIFIED) return revenueBasis;
  if (!revenueBasis.currency) return { ...revenueBasis, status: STATUS.UNKNOWN };
  if (!costCurrency) return revenueBasis;
  if (normalizeCurrency(costCurrency) !== normalizeCurrency(revenueBasis.currency)) {
    return { ...revenueBasis, status: STATUS.NEEDS_REVIEW_FX };
  }
  return revenueBasis;
};

module.exports = {
  STATUS,
  applyRevenueCostCurrencyCheck,
  resolveVerifiedSupplierRevenueBasis
};