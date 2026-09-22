const Invoice = require("../../models/Invoice");
const Payment = require("../../models/Payment");
const PaymentAllocation = require("../../models/PaymentAllocation");
const ServiceCompletion = require("../../models/ServiceCompletion");
const JournalEntry = require("../../models/JournalEntry");
const JournalEntryLine = require("../../models/JournalEntryLine");
const AccountingMapping = require("../../models/AccountingMapping");
const ChartOfAccount = require("../../models/ChartOfAccount");
const AccountingPeriod = require("../../models/AccountingPeriod");
const { DEFAULT_ACCOUNTING_MAPPINGS } = require("../../accounting/defaultAccountingMappings");
const { GL_MAPPING_KEY } = require("../../accounting/constants");
const ledger = require("../generalLedger/ledger");
const { env } = require("../../config/env");
const AppError = require("../../utils/AppError");
const { normalizeCurrency, toDecimal } = require("../../utils/money");

const STATES = Object.freeze({
  READY_TO_POST: "READY_TO_POST",
  POSTING: "POSTING",
  POSTED: "POSTED",
  POSTING_BLOCKED: "POSTING_BLOCKED",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  FAILED_RETRYABLE: "FAILED_RETRYABLE"
});

const normalize = (value) => String(value || "").trim().toUpperCase();
const idOf = (value) => String(value?._id || value?.id || value || "");
const invoiceKey = (invoice) => `customer-invoice:${idOf(invoice)}:v1`;
const paymentKey = (payment) => `customer-payment:${idOf(payment)}:v1`;
const paymentAmount = (payment) => payment?.accountingAmount ?? payment?.amountPaid ?? payment?.paidAmount ?? payment?.amount ?? 0;
const paymentCurrency = (payment) => normalizeCurrency(payment?.accountingCurrency || payment?.currency || payment?.orderCurrency || "");
const paymentClassificationBlockers = (payment = {}) => {
  const treatment = normalize(payment.accountingTreatment);
  return ["ADVANCE_PAYMENT", "CUSTOMER_DEPOSIT"].includes(treatment)
    ? ["ADVANCE_PAYMENT_CLASSIFICATION_REQUIRED"]
    : [];
};
const providerClearingKey = (provider = "") => {
  const normalized = normalize(provider);
  if (normalized === "PESAPAL") return GL_MAPPING_KEY.PESAPAL_CLEARING;
  if (normalized === "PAYPAL") return GL_MAPPING_KEY.PAYPAL_CLEARING;
  if (normalized === "DPO") return GL_MAPPING_KEY.DPO_CLEARING;
  if (normalized === "MOBILE_MONEY") return GL_MAPPING_KEY.MOBILE_MONEY;
  return "";
};
const hasProcessorReference = (payment = {}) => [
  payment.providerTransactionId,
  payment.orderTrackingId,
  payment.confirmationCode,
  payment.merchantReference
].some(Boolean);
const paymentEvidenceBlockers = async ({ payment = {}, allocation = null } = {}) => {
  const blockers = [];
  const provider = normalize(payment.provider);
  const currency = paymentCurrency(payment);
  if (allocation && !allocation.invoiceId) blockers.push("PAYMENT_INVOICE_ASSOCIATION_REQUIRED");
  if (!currency) blockers.push("MISSING_PAYMENT_CURRENCY");
  if (provider && !normalize(payment.paymentMethod)) blockers.push("MISSING_PAYMENT_METHOD");
  if (provider && ["PESAPAL", "PAYPAL", "DPO"].includes(provider) && !hasProcessorReference(payment)) blockers.push("MISSING_PROCESSOR_REFERENCE");
  if (provider) {
    const clearingKey = providerClearingKey(provider);
    if (!clearingKey || !(await hasActiveMapping(clearingKey))) blockers.push("MISSING_CLEARING_ACCOUNT");
  }
  if (currency && normalize(env.ACCOUNTING_BASE_CURRENCY) !== currency && !payment.fxRate && !payment.settlementFx?.rate) blockers.push("FX_POLICY_REQUIRED");
  const postingDate = payment.paidAt || payment.lastVerifiedAt || payment.createdAt;
  if (postingDate) {
    const period = await AccountingPeriod.findOne({ startDate: { $lte: postingDate }, endDate: { $gte: postingDate } }).lean();
    if (!period) blockers.push("PERIOD_NOT_FOUND");
    else if (["CLOSED", "LOCKED"].includes(normalize(period.status))) blockers.push("POSTING_BLOCKED_CLOSED_PERIOD");
  }
  return blockers;
};
const sameMoney = (left, right) => {
  try { return toDecimal(left, { allowNegative: false }).equals(toDecimal(right, { allowNegative: false })); } catch { return false; }
};
const directChannels = new Set(["DIRECT_WEBSITE", "AGENT", "B2B", "HOTEL", "WHATSAPP", "WALK_IN"]);
const revenueMappingKey = (booking = {}) => {
  const value = normalize(booking.serviceType || booking.productType || booking.productTitle || "");
  return value.includes("TRANSFER") ? "TRANSFER_REVENUE" : "TOUR_REVENUE";
};

const hasActiveMapping = async (mappingKey) => {
  const mapping = await AccountingMapping.findOne({ mappingKey, active: true }).lean()
    || DEFAULT_ACCOUNTING_MAPPINGS.find((item) => item.mappingKey === mappingKey);
  if (!mapping?.accountCode) return false;
  const account = await ChartOfAccount.findOne({ code: mapping.accountCode, active: { $ne: false } }).lean();
  return Boolean(account);
};

const completeJournal = async (postingKey) => {
  const journal = await JournalEntry.findOne({ "source.postingKey": postingKey }).lean();
  if (!journal) return null;
  const lines = await JournalEntryLine.find({ journalEntryId: journal._id }).lean();
  return lines.length === Number(journal.lineCount || 0) && lines.length > 0 ? { journal, lines } : { journal, lines: [] };
};

const reviewStatusFor = (blockers) => blockers.includes("ALREADY_POSTED")
  ? STATES.POSTED
  : blockers.includes("INCOMPLETE_JOURNAL")
    ? STATES.NEEDS_REVIEW
    : STATES.POSTING_BLOCKED;

const evaluateInvoice = async ({ invoice, booking, completion } = {}) => {
  const blockers = [];
  const channel = normalize(booking?.salesChannel || booking?.sourceChannel);
  const cancelled = normalize(booking?.bookingStatus) === "CANCELLED";
  if (!invoice?._id) blockers.push("IDENTITY_CONFLICT");
  if (!booking) blockers.push("BOOKING_NOT_FOUND");
  if (cancelled && (!completion || completion.status !== "COMPLETED")) blockers.push("CANCELLATION_FEE_REVIEW_REQUIRED");
  else if (!completion) blockers.push("SERVICE_COMPLETION_REQUIRED");
  if (completion && completion.status === "NO_SHOW") blockers.push("NO_SHOW_POLICY_REVIEW_REQUIRED");
  else if (completion && completion.status !== "COMPLETED") blockers.push("SERVICE_COMPLETION_REQUIRED");
  if (completion && (!completion.verifiedAt || !completion.evidenceSource)) blockers.push("SERVICE_COMPLETION_REQUIRED");
  if (!directChannels.has(channel)) {
    const otaMappingKeys = channel === "GETYOURGUIDE"
      ? [GL_MAPPING_KEY.GYG_RECEIVABLE, GL_MAPPING_KEY.OTA_COMMISSION]
      : channel === "VIATOR"
        ? [GL_MAPPING_KEY.VIATOR_RECEIVABLE, GL_MAPPING_KEY.OTA_COMMISSION]
        : [];
    if (channel === "GETYOURGUIDE" && !(await hasActiveMapping(otaMappingKeys[0]))) blockers.push("OTA_RECEIVABLE_MAPPING_REQUIRED");
    if (channel === "VIATOR" && !(await hasActiveMapping(otaMappingKeys[0]))) blockers.push("OTA_RECEIVABLE_MAPPING_REQUIRED");
    if (otaMappingKeys.length && !(await hasActiveMapping(otaMappingKeys[1]))) blockers.push("OTA_COMMISSION_MAPPING_REQUIRED");
    if (!otaMappingKeys.length) blockers.push("OTA_FINANCIAL_BREAKDOWN_REQUIRED");
  }
  if (!invoice?.accountingCurrency || normalize(invoice.accountingCurrency) !== normalize(env.ACCOUNTING_BASE_CURRENCY)) blockers.push("FX_RATE_REQUIRED");
  if (!(Number(invoice.accountingTotal ?? invoice.total ?? 0) > 0)) blockers.push("INVALID_AMOUNT");
  const completionDate = completion?.completedAt ? new Date(completion.completedAt) : null;
  if (completionDate && !Number.isNaN(completionDate.getTime())) {
    const period = await AccountingPeriod.findOne({ startDate: { $lte: completionDate }, endDate: { $gte: completionDate } }).lean();
    if (!period) blockers.push("PERIOD_NOT_FOUND");
    else if (["CLOSED", "LOCKED"].includes(normalize(period.status))) blockers.push("ACCOUNTING_PERIOD_CLOSED");
  }
  const [arMapped, revenueMapped] = await Promise.all([hasActiveMapping("ACCOUNTS_RECEIVABLE"), hasActiveMapping(revenueMappingKey(booking))]);
  if (!arMapped || !revenueMapped) blockers.push("MAPPING_REQUIRED");
  const postingKey = invoiceKey(invoice);
  const existing = await completeJournal(postingKey);
  if (existing?.journal && !existing.lines.length) blockers.push("INCOMPLETE_JOURNAL");
  if (existing?.journal && existing.lines.length) blockers.push("ALREADY_POSTED");
  const unique = [...new Set(blockers)];
  if (!unique.length) unique.push("SERVICE_REVENUE_RECOGNITION_REQUIRED");
  return { eligible: unique.length === 0, status: unique.length ? reviewStatusFor(unique) : STATES.READY_TO_POST, blockers: unique, postingKey };
};

const postInvoice = async ({ invoice, booking } = {}) => {
  const completion = await ServiceCompletion.findOne({ bookingReference: booking?.bookingReference }).sort({ verifiedAt: -1 }).lean();
  const eligibility = await evaluateInvoice({ invoice, booking, completion });
  if (!eligibility.eligible) {
    if (eligibility.status === STATES.NEEDS_REVIEW) {
      await Invoice.updateOne({ _id: invoice?._id }, { $set: { accountingStatus: STATES.NEEDS_REVIEW, accountingPostingKey: eligibility.postingKey, accountingBlockers: eligibility.blockers } });
    }
    return { action: eligibility.status === STATES.POSTED ? "existing" : "blocked", eligibility };
  }
  // Legacy invoice-gross recognition is retired; the component event is canonical.
  return { action: "blocked", eligibility: { ...eligibility, eligible: false, status: STATES.NEEDS_REVIEW, blockers: ["SERVICE_REVENUE_RECOGNITION_REQUIRED"] } };
};

const postPayment = async ({ payment, auth = {}, requestId = "" } = {}) => {
  const blockers = paymentClassificationBlockers(payment);
  const postingKey = paymentKey(payment);
  const invoice = await Invoice.findOne({ bookingReference: payment?.bookingReference }).lean();
  const invoiceJournal = invoice ? await completeJournal(invoiceKey(invoice)) : null;
  const paymentJournal = await completeJournal(postingKey);
  const allocation = payment?._id
    ? await PaymentAllocation.findOne({ paymentId: payment._id, bookingReference: payment.bookingReference, status: "applied" }).lean()
    : null;
  if (!payment?._id || !payment?.intentId && !payment?.providerTransactionId && !payment?.orderTrackingId) blockers.push("IDENTITY_CONFLICT");
  if (payment?.status !== "paid" || payment?.verificationStatus !== "verified") blockers.push("PAYMENT_NOT_VERIFIED");
  if (!allocation) blockers.push("PAYMENT_ALLOCATION_REQUIRED");
  else if (!sameMoney(paymentAmount(payment), allocation.amount) || paymentCurrency(payment) !== normalizeCurrency(allocation.currency)) blockers.push("PAYMENT_ALLOCATION_MISMATCH");
  blockers.push(...await paymentEvidenceBlockers({ payment, allocation }));
  if (!invoiceJournal?.journal || !invoiceJournal.lines.length) blockers.push("AR_INVOICE_NOT_POSTED");
  if (paymentJournal?.journal && paymentJournal.lines.length) blockers.push("ALREADY_POSTED");
  if (paymentJournal?.journal && !paymentJournal.lines.length) blockers.push("INCOMPLETE_JOURNAL");
  if (!(Number(payment?.accountingAmount ?? payment?.amountPaid ?? payment?.paidAmount ?? 0) > 0)) blockers.push("INVALID_AMOUNT");
  const unique = [...new Set(blockers)];
  const eligibility = { eligible: unique.length === 0, status: unique.length ? reviewStatusFor(unique) : STATES.READY_TO_POST, blockers: unique, postingKey };
  if (!eligibility.eligible) {
    if (eligibility.status === STATES.NEEDS_REVIEW) {
      await Payment.updateOne({ _id: payment?._id }, { $set: { accountingStatus: STATES.NEEDS_REVIEW, accountingPostingKey: postingKey, accountingBlockers: eligibility.blockers } });
    }
    return { action: eligibility.status === STATES.POSTED ? "existing" : "blocked", eligibility };
  }
  if (env.CUSTOMER_PAYMENT_AUTOMATIC_POSTING_ENABLED !== true) return { action: "preview", eligibility };
  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, accountingStatus: { $in: ["", STATES.READY_TO_POST, STATES.FAILED_RETRYABLE] } },
    { $set: { accountingStatus: STATES.POSTING, accountingPostingKey: postingKey, accountingBlockers: [] } },
    { new: true }
  ).lean();
  if (!claimed) return { action: "blocked", eligibility: { ...eligibility, blockers: ["POSTING_IN_PROGRESS"] } };
  try {
    const result = await ledger.postCustomerPayment({ payment, auth, requestId, postingKey });
    const journalId = result?.journal?._id || result?.journal?.id || result?.id || null;
    await Payment.updateOne({ _id: payment._id }, { $set: { accountingStatus: STATES.POSTED, accountingJournalEntryId: journalId, accountingPostedAt: new Date(), accountingBlockers: [] } });
    return { action: result?.action || "posted", journal: result?.journal || result, eligibility };
  } catch (error) {
    if (error?.code === 11000) {
      const recovered = await completeJournal(postingKey);
      if (recovered?.journal && recovered.lines.length) {
        await Payment.updateOne({ _id: payment._id }, { $set: { accountingStatus: STATES.POSTED, accountingJournalEntryId: recovered.journal._id, accountingPostedAt: recovered.journal.postedAt || new Date(), accountingBlockers: [] } });
        return { action: "existing", journal: recovered.journal, eligibility };
      }
    }
    await Payment.updateOne({ _id: payment._id }, { $set: { accountingStatus: STATES.FAILED_RETRYABLE, accountingBlockers: ["POSTING_FAILED"] } });
    throw error;
  }
};

const previewInvoice = async ({ invoiceNumber = "", bookingReference = "" } = {}) => {
  const invoice = await Invoice.findOne(invoiceNumber ? { invoiceNumber } : { bookingReference }).lean();
  if (!invoice) throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
  const completion = await ServiceCompletion.findOne({ bookingReference: invoice.bookingReference }).sort({ verifiedAt: -1 }).lean();
  const eligibility = completion ? await require("../revenueRecognition").preview({ completionId: completion._id }) : { eligible: false, status: STATES.NEEDS_REVIEW, blockers: ["SERVICE_COMPLETION_REQUIRED"] };
  return { invoice: { id: invoice._id, invoiceNumber: invoice.invoiceNumber, bookingReference: invoice.bookingReference }, eligibility, automationEnabled: env.REVENUE_RECOGNITION_AUTOMATIC_ENABLED === true };
};

const previewPayment = async ({ paymentId = "" } = {}) => {
  const payment = await Payment.findById(paymentId).lean();
  if (!payment) throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
  const blockers = paymentClassificationBlockers(payment);
  const invoice = await Invoice.findOne({ bookingReference: payment.bookingReference }).lean();
  const allocation = await PaymentAllocation.findOne({ paymentId: payment._id, bookingReference: payment.bookingReference, status: "applied" }).lean();
  blockers.push(...await paymentEvidenceBlockers({ payment, allocation }));
  if (!invoice) blockers.push("INVOICE_NOT_FOUND");
  if (!allocation) blockers.push("PAYMENT_ALLOCATION_REQUIRED");
  else if (!sameMoney(paymentAmount(payment), allocation.amount) || paymentCurrency(payment) !== normalizeCurrency(allocation.currency)) blockers.push("PAYMENT_ALLOCATION_MISMATCH");
  const invoiceJournal = invoice ? await completeJournal(invoiceKey(invoice)) : null;
  if (!invoiceJournal?.journal || !invoiceJournal.lines.length) blockers.push("AR_INVOICE_NOT_POSTED");
  if (payment.status !== "paid" || payment.verificationStatus !== "verified") blockers.push("PAYMENT_NOT_VERIFIED");
  return { payment: { id: payment._id, bookingReference: payment.bookingReference, intentId: payment.intentId || "" }, eligibility: { eligible: blockers.length === 0, status: blockers.length ? STATES.POSTING_BLOCKED : STATES.READY_TO_POST, blockers: [...new Set(blockers)], postingKey: paymentKey(payment) }, automationEnabled: env.CUSTOMER_PAYMENT_AUTOMATIC_POSTING_ENABLED === true };
};

module.exports = { STATES, evaluateInvoice, postInvoice, postPayment, previewInvoice, previewPayment, invoiceKey, paymentKey, paymentClassificationBlockers, paymentEvidenceBlockers };
