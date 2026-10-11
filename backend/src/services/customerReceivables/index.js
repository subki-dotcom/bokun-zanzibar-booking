// Customer receivable workflows that are not driven by an online gateway:
//   - manual (cash / bank transfer / mobile money) payments, including partial payments and FX receipts;
//   - standalone (non-booking) invoices and their delivery-based revenue posting;
//   - approved invoice adjustments (credit and debit notes).
// Every workflow keeps the invoice, booking, receivables and general ledger consistent and never posts to the
// ledger unless the existing automation flags allow it.
const crypto = require("crypto");
const mongoose = require("mongoose");
const Invoice = require("../../models/Invoice");
const InvoiceAdjustment = require("../../models/InvoiceAdjustment");
const Booking = require("../../models/Booking");
const Payment = require("../../models/Payment");
const PaymentAllocation = require("../../models/PaymentAllocation");
const RevenueRecognition = require("../../models/RevenueRecognition");
const AccountingPeriod = require("../../models/AccountingPeriod");
const AccountingMapping = require("../../models/AccountingMapping");
const ChartOfAccount = require("../../models/ChartOfAccount");
const JournalEntryLine = require("../../models/JournalEntryLine");
const AuditLog = require("../../models/AuditLog");
const { DEFAULT_ACCOUNTING_MAPPINGS } = require("../../accounting/defaultAccountingMappings");
const { GL_MAPPING_KEY, GL_POSTING_TYPE, SOURCE_MODULE } = require("../../accounting/constants");
const { isReceivableInvoice } = require("../../accounting/salesPolicy");
const { env } = require("../../config/env");
const AppError = require("../../utils/AppError");
const { Decimal, normalizeCurrency, toDecimal } = require("../../utils/money");
const paymentsService = require("../payments");
const { resolveInvoiceAccounting } = require("../invoices");
const ledger = require("../generalLedger/ledger");

const MANUAL_METHODS = Object.freeze({
  CASH: { provider: "cash_on_arrival", paymentMethod: "CASH" },
  BANK_TRANSFER: { provider: "manual_bank", paymentMethod: "BANK_TRANSFER" },
  MOBILE_MONEY: { provider: "mobile_money", paymentMethod: "MOBILE_MONEY" }
});
const MANUAL_PROVIDERS = Object.values(MANUAL_METHODS).map((method) => method.provider);
const STANDALONE_REVENUE_KEYS = [GL_MAPPING_KEY.OTHER_SERVICE_REVENUE, GL_MAPPING_KEY.TOUR_REVENUE, GL_MAPPING_KEY.TRANSFER_REVENUE];

const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const token = (value) => String(value || "").trim();
const upper = (value) => token(value).toUpperCase();
const money = (value) => toDecimal(value ?? 0).toDecimalPlaces(2);
const toNumber = (value) => Number(money(value).toFixed(2));
const decimal128 = (value) => mongoose.Types.Decimal128.fromString(money(value).toFixed(2));
const actor = (auth = {}) => token(auth.id || auth._id || auth.email || "system");

const invoiceCurrencyOf = (invoice = {}) =>
  normalizeCurrency(invoice.accountingCurrency || invoice.transactionCurrency || "USD");

const invoiceTotalOf = (invoice = {}) => money(invoice.totalAmount?.toString?.() ?? invoice.total ?? 0);

const audit = ({ action, entityType, entityId, reference = "", auth = {}, requestId = "", reason = "", before = null, after = null, metadata = {} }) =>
  AuditLog.create({
    actorId: actor(auth),
    actorRole: auth.role || "system",
    action,
    entityType,
    entityId: String(entityId || ""),
    reference,
    reason,
    requestId,
    before,
    after,
    metadata
  });

const assertOpenPeriod = async (date, code = "POSTING_BLOCKED_CLOSED_PERIOD") => {
  const period = await AccountingPeriod.findOne({ startDate: { $lte: date }, endDate: { $gte: date } }).lean();
  if (period && ["CLOSED", "LOCKED"].includes(upper(period.status))) {
    throw new AppError("The accounting period for this date is closed.", 409, code);
  }
  return period;
};

const hasActiveMapping = async (mappingKey) => {
  const mapping = await AccountingMapping.findOne({ mappingKey, active: true }).lean()
    || DEFAULT_ACCOUNTING_MAPPINGS.find((item) => item.mappingKey === mappingKey);
  if (!mapping?.accountCode) return null;
  return ChartOfAccount.findOne({ code: mapping.accountCode, active: { $ne: false } }).lean();
};

// Revenue is recognized for a booking by the revenue recognition module, and for a standalone invoice by
// its delivery posting. Either way, customer money received afterwards settles a receivable.
const revenueRecognizedFor = async (invoice = {}) => {
  if (invoice.invoiceType === "STANDALONE") return invoice.revenuePosting?.status === "POSTED";
  return Boolean(await RevenueRecognition.findOne({
    bookingReference: invoice.bookingReference,
    status: { $in: ["POSTED", "PARTIALLY_REVERSED"] }
  }).lean());
};

// ---------------------------------------------------------------------------------------------------------------
// Invoice recomputation
// ---------------------------------------------------------------------------------------------------------------

const recomputeStandaloneInvoice = async (invoice) => {
  const currency = invoiceCurrencyOf(invoice);
  const paid = await paymentsService.getVerifiedAccountingSummary({ bookingReference: invoice.bookingReference, fallbackCurrency: currency });
  if (paid.currency && paid.currency !== currency) {
    throw new AppError("Verified payment currency does not match the invoice.", 409, "INVOICE_ACCOUNTING_CURRENCY_MISMATCH");
  }
  const total = Decimal.max(0, money(invoice.subtotal ?? 0).plus(money(invoice.adjustmentTotal ?? 0)));
  const resolved = resolveInvoiceAccounting({
    bookingStatus: invoice.bookingStatus,
    total: total.toFixed(2),
    verifiedPaidAmount: paid.amount,
    confirmedRefundedAmount: 0
  });
  await Invoice.updateOne({ _id: invoice._id }, {
    $set: {
      total: toNumber(total),
      paymentStatus: resolved.paymentStatus,
      amountPaid: resolved.amountPaid,
      amountRefunded: resolved.amountRefunded,
      netAmountPaid: resolved.netAmountPaid,
      balanceDue: resolved.balanceDue,
      totalAmount: decimal128(resolved.canonical.totalAmount),
      paidAccountingAmount: decimal128(resolved.canonical.paidAccountingAmount),
      refundedAccountingAmount: decimal128(resolved.canonical.refundedAccountingAmount),
      netAccountingAmount: decimal128(resolved.canonical.netAccountingAmount),
      balanceDueAmount: decimal128(resolved.canonical.balanceDueAmount)
    }
  });
  return Invoice.findById(invoice._id).lean();
};

const recomputeInvoice = async (invoice, { requestId = "", reason = "Customer receivable updated" } = {}) => {
  if (invoice.invoiceType === "STANDALONE") return recomputeStandaloneInvoice(invoice);
  // Booking invoices are always rebuilt from the booking by the canonical invoice builder.
  const bookingsService = require("../bookings");
  await bookingsService.syncInvoiceForBookingReference({ bookingReference: invoice.bookingReference, requestId, reason });
  const updated = await Invoice.findById(invoice._id).lean();
  const booking = await Booking.findOne({ bookingReference: invoice.bookingReference });
  // Locally collected money drives the booking payment status (OTA-collected bookings keep their own status).
  if (booking && updated.guestPaymentSource !== "OTA_CHANNEL" && ["partial", "paid", "overpaid"].includes(updated.paymentStatus)) {
    booking.paymentStatus = updated.paymentStatus === "overpaid" ? "paid" : updated.paymentStatus;
    await booking.save();
  }
  return updated;
};

const loadInvoice = async (invoiceNumber) => {
  const invoice = await Invoice.findOne({ invoiceNumber: token(invoiceNumber) }).lean();
  if (!invoice) throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
  return invoice;
};

// ---------------------------------------------------------------------------------------------------------------
// Manual payments (cash, bank transfer, mobile money; full or partial)
// ---------------------------------------------------------------------------------------------------------------

const recordManualPayment = async ({ input = {}, auth = {}, requestId = "" } = {}) => {
  const method = MANUAL_METHODS[upper(input.method)];
  if (!method) throw new AppError("Payment method must be CASH, BANK_TRANSFER or MOBILE_MONEY.", 422, "MANUAL_PAYMENT_METHOD_INVALID");
  const idempotencyKey = token(input.idempotencyKey);
  const evidenceReference = token(input.evidenceReference);
  if (!idempotencyKey) throw new AppError("An idempotency key is required.", 422, "IDEMPOTENCY_KEY_REQUIRED");
  if (!evidenceReference) throw new AppError("A receipt, bank or mobile-money reference is required.", 422, "PAYMENT_EVIDENCE_REQUIRED");

  const invoice = await loadInvoice(input.invoiceNumber);
  const intentId = `manual-${hash(idempotencyKey).slice(0, 32)}`;
  const replay = await Payment.findOne({ intentId }).lean();
  if (replay) {
    const sameRequest = replay.bookingReference === invoice.bookingReference &&
      money(replay.chargedAmount?.toString?.() ?? replay.amount).equals(money(input.amount)) &&
      normalizeCurrency(replay.chargedCurrency || replay.currency) === normalizeCurrency(input.currency);
    if (!sameRequest) throw new AppError("This idempotency key was already used for a different payment.", 409, "IDEMPOTENCY_KEY_REUSED");
    return { replay: true, payment: replay, invoice };
  }
  const duplicateEvidence = await Payment.findOne({ provider: method.provider, providerTransactionId: evidenceReference, status: "paid" }).lean();
  if (duplicateEvidence) throw new AppError("This payment reference is already recorded.", 409, "DUPLICATE_PAYMENT_EVIDENCE");

  if (invoice.invoiceType !== "STANDALONE") {
    if (invoice.guestPaymentSource === "OTA_CHANNEL") {
      throw new AppError("The OTA collected this booking's payment; record the OTA settlement instead.", 409, "OTA_COLLECTED_BOOKING");
    }
    if (!isReceivableInvoice(invoice)) throw new AppError("This invoice is not a sale and has no customer balance.", 409, "INVOICE_NOT_RECEIVABLE");
  }

  const invoiceCurrency = invoiceCurrencyOf(invoice);
  const paidCurrency = normalizeCurrency(input.currency);
  if (!paidCurrency) throw new AppError("Payment currency is required.", 422, "PAYMENT_CURRENCY_REQUIRED");
  const paidAmount = money(input.amount);
  if (!paidAmount.greaterThan(0)) throw new AppError("Payment amount must be positive.", 422, "PAYMENT_AMOUNT_INVALID");
  let accountingAmount = paidAmount;
  let fxRate = null;
  if (paidCurrency !== invoiceCurrency) {
    // A receipt in another currency needs the rate actually applied, its source and date.
    const rate = input.fx?.rate !== undefined ? toDecimal(input.fx.rate) : null;
    if (!rate || !rate.greaterThan(0) || !token(input.fx?.source) || !token(input.fx?.date)) {
      throw new AppError(`Payment is in ${paidCurrency} but the invoice is in ${invoiceCurrency}; provide the applied FX rate, source and date.`, 422, "FX_EVIDENCE_REQUIRED");
    }
    fxRate = rate;
    accountingAmount = paidAmount.times(rate).toDecimalPlaces(2);
  }

  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  if (Number.isNaN(receivedAt.getTime()) || receivedAt > new Date()) throw new AppError("Received date is invalid.", 422, "PAYMENT_DATE_INVALID");
  await assertOpenPeriod(receivedAt);

  const balance = money(invoice.balanceDueAmount?.toString?.() ?? invoice.balanceDue ?? 0);
  if (accountingAmount.greaterThan(balance.plus("0.009"))) {
    throw new AppError(`Payment of ${accountingAmount.toFixed(2)} ${invoiceCurrency} exceeds the balance due of ${balance.toFixed(2)}.`, 409, "OVERPAYMENT_NOT_ALLOWED");
  }

  const payment = await Payment.create({
    intentId,
    attemptId: intentId,
    bookingReference: invoice.bookingReference,
    provider: method.provider,
    paymentMethod: method.paymentMethod,
    providerTransactionId: evidenceReference,
    merchantReference: `${invoice.invoiceNumber}:${evidenceReference}`,
    amount: toNumber(paidAmount),
    currency: paidCurrency,
    orderAmount: decimal128(accountingAmount),
    orderCurrency: invoiceCurrency,
    chargedAmount: decimal128(paidAmount),
    chargedCurrency: paidCurrency,
    accountingAmount: decimal128(accountingAmount),
    accountingCurrency: invoiceCurrency,
    fxRate: fxRate ? mongoose.Types.Decimal128.fromString(fxRate.toFixed()) : null,
    fxSourceCurrency: fxRate ? paidCurrency : "",
    fxTargetCurrency: fxRate ? invoiceCurrency : "",
    fxSource: fxRate ? token(input.fx.source) : "none",
    fxQuotedAt: fxRate ? new Date(input.fx.date) : null,
    status: "paid",
    paymentStatus: "paid",
    providerStatus: "ADMIN_RECORDED",
    verificationStatus: "verified",
    verificationReason: "Authorized staff recorded a manual receipt with evidence",
    accountingAllocationStatus: "pending",
    amountPaid: toNumber(accountingAmount),
    paidAmount: toNumber(accountingAmount),
    paidAt: receivedAt,
    lastVerifiedAt: new Date(),
    rawResponse: { source: "manual_receipt", recordedBy: actor(auth), evidenceReference, notes: token(input.notes) }
  });
  await paymentsService.applyVerifiedPaymentAllocation({ paymentId: payment._id, metadata: { source: "manual_receipt", invoiceNumber: invoice.invoiceNumber } });
  await paymentsService.linkAllocationsToInvoice({ bookingReference: invoice.bookingReference, invoiceId: invoice._id });
  const updated = await recomputeInvoice(invoice, { requestId, reason: "Manual customer payment recorded" });
  await audit({
    action: "customer_manual_payment_recorded",
    entityType: "Payment",
    entityId: payment._id,
    reference: invoice.invoiceNumber,
    auth,
    requestId,
    reason: token(input.notes) || "Manual customer payment recorded",
    after: { amount: toNumber(paidAmount), currency: paidCurrency, accountingAmount: toNumber(accountingAmount), invoiceCurrency, method: method.paymentMethod, evidenceReference }
  });
  return { replay: false, payment: await Payment.findById(payment._id).lean(), invoice: updated };
};

// A bounced transfer or miscounted cash receipt is voided only while it is still off the ledger; once posted it
// needs a reversal journal so the original evidence is preserved.
const voidManualPayment = async ({ paymentId, reason = "", auth = {}, requestId = "" } = {}) => {
  if (!token(reason)) throw new AppError("A reason is required to void a payment.", 422, "VOID_REASON_REQUIRED");
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
  if (!MANUAL_PROVIDERS.includes(payment.provider)) throw new AppError("Only manually recorded payments can be voided here.", 409, "NOT_A_MANUAL_PAYMENT");
  if (payment.status === "reversed") return { replay: true, payment: payment.toObject() };
  if (upper(payment.accountingStatus) === "POSTED") {
    throw new AppError("This payment is already in the general ledger; post a reversal journal instead.", 409, "REVERSAL_JOURNAL_REQUIRED");
  }
  const invoice = await Invoice.findOne({ bookingReference: payment.bookingReference }).lean();
  const before = { status: payment.status, amount: payment.amount };
  payment.status = "reversed";
  payment.paymentStatus = "reversed";
  payment.verificationReason = `Voided: ${token(reason)}`;
  payment.accountingAllocationStatus = "reversed";
  await payment.save();
  await PaymentAllocation.updateMany({ paymentId: payment._id, status: "applied" }, { $set: { status: "reversed" } });
  const updated = invoice ? await recomputeInvoice(invoice, { requestId, reason: "Manual customer payment voided" }) : null;
  if (updated && updated.invoiceType !== "STANDALONE") {
    // Recompute the booking status from what is still verified.
    const booking = await Booking.findOne({ bookingReference: payment.bookingReference });
    if (booking && booking.paymentStatus !== "failed") {
      booking.paymentStatus = updated.paymentStatus === "pending" ? "pending" : updated.paymentStatus;
      await booking.save();
    }
  }
  await audit({ action: "customer_manual_payment_voided", entityType: "Payment", entityId: payment._id, reference: payment.bookingReference, auth, requestId, reason, before, after: { status: "reversed" } });
  return { replay: false, payment: payment.toObject(), invoice: updated };
};

// ---------------------------------------------------------------------------------------------------------------
// Standalone invoices
// ---------------------------------------------------------------------------------------------------------------

const createStandaloneInvoice = async ({ input = {}, auth = {}, requestId = "" } = {}) => {
  const idempotencyKey = token(input.idempotencyKey);
  if (!idempotencyKey) throw new AppError("An idempotency key is required.", 422, "IDEMPOTENCY_KEY_REQUIRED");
  const invoiceNumber = `SINV-${hash(idempotencyKey).slice(0, 10).toUpperCase()}`;
  const existing = await Invoice.findOne({ invoiceNumber }).lean();
  if (existing) return { replay: true, invoice: existing };

  const currency = normalizeCurrency(input.currency);
  if (!currency) throw new AppError("Invoice currency is required.", 422, "INVOICE_CURRENCY_REQUIRED");
  const lines = (Array.isArray(input.lines) ? input.lines : []).map((line) => {
    const quantity = toDecimal(line.quantity ?? 1);
    const unitPrice = money(line.unitPrice);
    if (!token(line.label) || !quantity.greaterThan(0) || unitPrice.isNegative()) {
      throw new AppError("Each invoice line needs a label, a positive quantity and a non-negative price.", 422, "INVOICE_LINE_INVALID");
    }
    return { label: token(line.label), quantity: Number(quantity.toFixed()), unitPrice: toNumber(unitPrice), total: toNumber(quantity.times(unitPrice)) };
  });
  if (!lines.length) throw new AppError("At least one invoice line is required.", 422, "INVOICE_LINES_REQUIRED");
  if (!token(input.customer?.name)) throw new AppError("A customer name is required.", 422, "INVOICE_CUSTOMER_REQUIRED");
  const revenueMappingKey = upper(input.revenueMappingKey || GL_MAPPING_KEY.OTHER_SERVICE_REVENUE);
  if (!STANDALONE_REVENUE_KEYS.includes(revenueMappingKey)) throw new AppError("Unsupported revenue mapping for a standalone invoice.", 422, "REVENUE_MAPPING_INVALID");
  const subtotal = lines.reduce((sum, line) => sum.plus(line.total), new Decimal(0));
  if (!subtotal.greaterThan(0)) throw new AppError("Invoice total must be positive.", 422, "INVOICE_TOTAL_INVALID");

  const created = await Invoice.create({
    invoiceNumber,
    // Standalone invoices have no booking; their own number is the reference that payments and allocations use.
    bookingReference: invoiceNumber,
    invoiceType: "STANDALONE",
    issueDate: new Date(),
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    paymentStatus: "pending",
    bookingStatus: "confirmed",
    clientName: token(input.customer.name),
    clientEmail: token(input.customer.email),
    clientPhone: token(input.customer.phone),
    tourName: token(input.description) || lines[0].label,
    items: lines,
    subtotal: toNumber(subtotal),
    discount: 0,
    tax: 0,
    total: toNumber(subtotal),
    amountPaid: 0,
    balanceDue: toNumber(subtotal),
    transactionCurrency: currency,
    accountingCurrency: currency,
    notes: token(input.notes),
    paymentTerms: token(input.paymentTerms),
    revenuePosting: { status: "", postingKey: `standalone-revenue:${invoiceNumber}:v1`, blockers: [] },
    adjustmentTotal: 0
  });
  // Stash the revenue mapping on the invoice without widening the schema for a single field.
  await Invoice.collection.updateOne({ _id: created._id }, { $set: { revenueMappingKey } });
  const invoice = await recomputeStandaloneInvoice(created.toObject());
  await audit({ action: "standalone_invoice_created", entityType: "Invoice", entityId: invoice._id, reference: invoiceNumber, auth, requestId, reason: "Standalone invoice issued", after: { total: invoice.total, currency } });
  return { replay: false, invoice };
};

// Revenue on a standalone invoice is earned when the service is delivered, mirroring the service-completion policy.
// Any customer deposit already posted for the invoice is released first; the remainder becomes a receivable.
const evaluateStandaloneRevenue = async ({ invoice, fx = null } = {}) => {
  const blockers = [];
  const currency = invoiceCurrencyOf(invoice);
  const base = upper(env.ACCOUNTING_BASE_CURRENCY || "USD");
  const total = money(invoice.totalAmount?.toString?.() ?? invoice.total ?? 0);
  if (invoice.invoiceType !== "STANDALONE") blockers.push("NOT_A_STANDALONE_INVOICE");
  if (!invoice.serviceDeliveredAt || !invoice.deliveryEvidence?.reference) blockers.push("DELIVERY_EVIDENCE_REQUIRED");
  if (!total.greaterThan(0)) blockers.push("INVOICE_TOTAL_INVALID");
  if (invoice.revenuePosting?.status === "POSTED") blockers.push("ALREADY_POSTED");
  let rate = new Decimal(1);
  if (currency !== base) {
    const fxRate = fx?.rate !== undefined ? toDecimal(fx.rate) : null;
    if (!fxRate || !fxRate.greaterThan(0) || !token(fx?.source) || !token(fx?.date)) blockers.push("FX_EVIDENCE_REQUIRED");
    else rate = fxRate;
  }
  const revenueKey = invoice.revenueMappingKey || GL_MAPPING_KEY.OTHER_SERVICE_REVENUE;
  const [revenueAccount, arAccount, depositAccount] = await Promise.all([
    hasActiveMapping(revenueKey), hasActiveMapping(GL_MAPPING_KEY.ACCOUNTS_RECEIVABLE), hasActiveMapping(GL_MAPPING_KEY.CUSTOMER_DEPOSIT)
  ]);
  if (!revenueAccount || revenueAccount.type !== "REVENUE") blockers.push("REVENUE_ACCOUNT_MAPPING_REQUIRED");
  if (!arAccount) blockers.push("RECEIVABLE_ACCOUNT_MAPPING_REQUIRED");
  const deliveredAt = invoice.serviceDeliveredAt ? new Date(invoice.serviceDeliveredAt) : null;
  if (deliveredAt) {
    const period = await AccountingPeriod.findOne({ startDate: { $lte: deliveredAt }, endDate: { $gte: deliveredAt } }).lean();
    if (!period) blockers.push("PERIOD_NOT_FOUND");
    else if (["CLOSED", "LOCKED"].includes(upper(period.status))) blockers.push("POSTING_BLOCKED_CLOSED_PERIOD");
  }
  // Deposits are posted in the invoice currency's base equivalent; release what is on the ledger for this invoice.
  const depositLines = depositAccount
    ? await JournalEntryLine.find({ bookingReference: invoice.bookingReference, accountCode: depositAccount.code, journalStatus: "POSTED" }).lean()
    : [];
  const depositBase = depositLines.reduce((sum, line) => sum.plus(toDecimal(line.baseCurrencyCredit?.toString?.() || 0)).minus(toDecimal(line.baseCurrencyDebit?.toString?.() || 0)), new Decimal(0));
  const revenueBase = total.times(rate).toDecimalPlaces(2);
  if (depositBase.greaterThan(revenueBase)) blockers.push("PREPAYMENT_EXCEEDS_REVENUE_REVIEW_REQUIRED");
  const receivableBase = Decimal.max(0, revenueBase.minus(Decimal.max(0, depositBase)));
  return { eligible: blockers.length === 0, blockers: [...new Set(blockers)], currency, rate, revenueBase, depositBase, receivableBase, revenueKey };
};

const confirmStandaloneDelivery = async ({ invoiceNumber, input = {}, auth = {}, requestId = "" } = {}) => {
  const invoice = await loadInvoice(invoiceNumber);
  if (invoice.invoiceType !== "STANDALONE") throw new AppError("Only standalone invoices use delivery confirmation.", 409, "NOT_A_STANDALONE_INVOICE");
  const deliveredAt = new Date(input.deliveredAt || Date.now());
  if (Number.isNaN(deliveredAt.getTime()) || deliveredAt > new Date()) throw new AppError("Delivery date is invalid.", 422, "DELIVERY_DATE_INVALID");
  if (!token(input.evidenceReference)) throw new AppError("Delivery evidence is required.", 422, "DELIVERY_EVIDENCE_REQUIRED");
  if (!invoice.serviceDeliveredAt) {
    await Invoice.updateOne({ _id: invoice._id, serviceDeliveredAt: null }, {
      $set: {
        serviceDeliveredAt: deliveredAt,
        deliveryEvidence: { reference: token(input.evidenceReference), confirmedBy: actor(auth), confirmedAt: new Date(), note: token(input.note) }
      }
    });
    await audit({ action: "standalone_invoice_delivery_confirmed", entityType: "Invoice", entityId: invoice._id, reference: invoice.invoiceNumber, auth, requestId, reason: token(input.note) || "Service delivered", after: { deliveredAt, evidenceReference: token(input.evidenceReference) } });
  }
  return postStandaloneRevenue({ invoiceNumber, fx: input.fx, auth, requestId });
};

const postStandaloneRevenue = async ({ invoiceNumber, fx = null, auth = {}, requestId = "" } = {}) => {
  const invoice = await loadInvoice(invoiceNumber);
  const evaluation = await evaluateStandaloneRevenue({ invoice, fx });
  if (!evaluation.eligible) {
    if (!evaluation.blockers.includes("ALREADY_POSTED")) {
      await Invoice.updateOne({ _id: invoice._id }, { $set: { "revenuePosting.status": "BLOCKED", "revenuePosting.blockers": evaluation.blockers } });
    }
    return { action: evaluation.blockers.includes("ALREADY_POSTED") ? "existing" : "blocked", evaluation: { ...evaluation, rate: evaluation.rate.toFixed() } };
  }
  if (env.REVENUE_RECOGNITION_AUTOMATIC_ENABLED !== true) {
    await Invoice.updateOne({ _id: invoice._id }, { $set: { "revenuePosting.status": "PREVIEW", "revenuePosting.blockers": [] } });
    return { action: "preview", evaluation: { ...evaluation, rate: evaluation.rate.toFixed() } };
  }
  const base = upper(env.ACCOUNTING_BASE_CURRENCY || "USD");
  const lines = [];
  if (evaluation.depositBase.greaterThan(0)) lines.push({ mappingKey: GL_MAPPING_KEY.CUSTOMER_DEPOSIT, debit: evaluation.depositBase.toFixed(2), currency: base, exchangeRate: "1", bookingReference: invoice.bookingReference });
  if (evaluation.receivableBase.greaterThan(0)) lines.push({ mappingKey: GL_MAPPING_KEY.ACCOUNTS_RECEIVABLE, debit: evaluation.receivableBase.toFixed(2), currency: base, exchangeRate: "1", bookingReference: invoice.bookingReference });
  lines.push({ mappingKey: evaluation.revenueKey, credit: evaluation.revenueBase.toFixed(2), currency: base, exchangeRate: "1", bookingReference: invoice.bookingReference });
  const result = await ledger.postSourceEvent({
    event: {
      sourceModule: SOURCE_MODULE.BUSINESS_ACCOUNTING,
      sourceEntityType: "StandaloneInvoice",
      sourceEntityId: String(invoice._id),
      sourceReference: invoice.invoiceNumber,
      postingType: GL_POSTING_TYPE.CUSTOMER_INVOICE,
      postingKey: invoice.revenuePosting?.postingKey || `standalone-revenue:${invoice.invoiceNumber}:v1`,
      postingDate: invoice.serviceDeliveredAt,
      description: `Service revenue earned for standalone invoice ${invoice.invoiceNumber}`,
      currency: base,
      lines,
      sourceSnapshot: { invoiceNumber: invoice.invoiceNumber, invoiceCurrency: evaluation.currency, rate: evaluation.rate.toFixed() },
      metadata: { invoiceCurrency: evaluation.currency, invoiceTotal: invoiceTotalOf(invoice).toFixed(2), fx: evaluation.currency === base ? null : fx }
    },
    auth,
    requestId
  });
  const journalId = result?.journal?._id || result?.journal?.id || null;
  await Invoice.updateOne({ _id: invoice._id }, { $set: { "revenuePosting.status": "POSTED", "revenuePosting.journalEntryId": journalId, "revenuePosting.blockers": [] } });
  return { action: result?.action || "posted", journal: result?.journal || result, evaluation: { ...evaluation, rate: evaluation.rate.toFixed() } };
};

// ---------------------------------------------------------------------------------------------------------------
// Invoice adjustments (credit / debit notes)
// ---------------------------------------------------------------------------------------------------------------

const planAdjustment = async ({ invoice, type, amount, currency }) => {
  const kind = upper(type);
  if (!["CREDIT_NOTE", "DEBIT_NOTE"].includes(kind)) throw new AppError("Adjustment type must be CREDIT_NOTE or DEBIT_NOTE.", 422, "ADJUSTMENT_TYPE_INVALID");
  const value = money(amount);
  if (!value.greaterThan(0)) throw new AppError("Adjustment amount must be positive.", 422, "ADJUSTMENT_AMOUNT_INVALID");
  const invoiceCurrency = invoiceCurrencyOf(invoice);
  if (normalizeCurrency(currency) !== invoiceCurrency) throw new AppError(`Adjustments must be in the invoice currency (${invoiceCurrency}).`, 422, "ADJUSTMENT_CURRENCY_MISMATCH");
  if (invoice.invoiceType !== "STANDALONE" && !isReceivableInvoice(invoice)) throw new AppError("This invoice is not a sale.", 409, "INVOICE_NOT_RECEIVABLE");
  if (invoice.guestPaymentSource === "OTA_CHANNEL") throw new AppError("OTA-collected invoices are adjusted through OTA settlement evidence.", 409, "OTA_COLLECTED_BOOKING");

  const totalBefore = invoiceTotalOf(invoice);
  const balanceBefore = money(invoice.balanceDueAmount?.toString?.() ?? invoice.balanceDue ?? 0);
  const recognized = await revenueRecognizedFor(invoice);
  if (kind === "CREDIT_NOTE") {
    // Crediting more than is still owed would turn the customer's money into a refund; use the refund workflow.
    if (value.greaterThan(balanceBefore)) throw new AppError("Credit exceeds the unpaid balance; use the refund workflow for money already received.", 409, "CREDIT_EXCEEDS_UNPAID_BALANCE");
  } else if (recognized) {
    throw new AppError("Revenue is already recognized; additional revenue must come through service recognition review.", 409, "DEBIT_NOTE_AFTER_RECOGNITION_REQUIRES_REVIEW");
  }
  const delta = kind === "CREDIT_NOTE" ? value.negated() : value;
  return {
    type: kind,
    amount: value,
    currency: invoiceCurrency,
    recognized,
    accountingTreatment: recognized ? "RECOGNIZED_REVENUE_CREDIT_NOTE" : "REVENUE_BASIS_ADJUSTMENT",
    totalBefore,
    totalAfter: totalBefore.plus(delta),
    balanceBefore,
    balanceAfter: balanceBefore.plus(delta),
    delta
  };
};

const adjustmentKey = ({ invoice, type, amount, reason }) =>
  `invoice-adjustment:${hash([invoice.invoiceNumber, upper(type), money(amount).toFixed(2), token(reason)].join("|")).slice(0, 40)}`;

const applyInvoiceAdjustment = async ({ invoiceNumber, input = {}, auth = {}, requestId = "" } = {}) => {
  const invoice = await loadInvoice(invoiceNumber);
  if (!token(input.reason)) throw new AppError("A reason is required.", 422, "ADJUSTMENT_REASON_REQUIRED");
  const plan = await planAdjustment({ invoice, type: input.type, amount: input.amount, currency: input.currency });
  const idempotencyKey = adjustmentKey({ invoice, type: input.type, amount: input.amount, reason: input.reason });
  const summary = {
    type: plan.type, amount: plan.amount.toFixed(2), currency: plan.currency, accountingTreatment: plan.accountingTreatment,
    totalBefore: plan.totalBefore.toFixed(2), totalAfter: plan.totalAfter.toFixed(2),
    balanceBefore: plan.balanceBefore.toFixed(2), balanceAfter: plan.balanceAfter.toFixed(2), idempotencyKey
  };
  if (input.dryRun) return { action: "preview", dryRun: true, ...summary };

  // Two-step approval: the approver confirms the previewed key with an explicit approval ID.
  if (!token(input.approvalId)) throw new AppError("An explicit approval ID is required to apply an invoice adjustment.", 422, "ADJUSTMENT_APPROVAL_REQUIRED");
  if (token(input.idempotencyKey) !== idempotencyKey) throw new AppError("The supplied key does not match the previewed adjustment.", 409, "ADJUSTMENT_KEY_MISMATCH");
  const existing = await InvoiceAdjustment.findOne({ idempotencyKey }).lean();
  if (existing) return { action: "existing", adjustment: existing };

  if (plan.recognized && env.CUSTOMER_PAYMENT_AUTOMATIC_POSTING_ENABLED !== true) {
    throw new AppError("This credit note reduces recognized revenue and needs ledger posting, which is disabled.", 409, "LEDGER_POSTING_DISABLED");
  }

  let adjustment;
  try {
    adjustment = await InvoiceAdjustment.create({
      adjustmentReference: `ADJ-${hash(idempotencyKey).slice(0, 12).toUpperCase()}`,
      idempotencyKey,
      invoiceNumber: invoice.invoiceNumber,
      bookingReference: invoice.bookingReference,
      invoiceType: invoice.invoiceType || "BOOKING",
      type: plan.type,
      amount: toNumber(plan.amount),
      currency: plan.currency,
      reason: token(input.reason),
      approvalId: token(input.approvalId),
      accountingTreatment: plan.accountingTreatment,
      totalBefore: toNumber(plan.totalBefore),
      totalAfter: toNumber(plan.totalAfter),
      balanceBefore: toNumber(plan.balanceBefore),
      balanceAfter: toNumber(plan.balanceAfter),
      appliedBy: actor(auth)
    });
  } catch (error) {
    if (error?.code === 11000) return { action: "existing", adjustment: await InvoiceAdjustment.findOne({ idempotencyKey }).lean() };
    throw error;
  }

  if (invoice.invoiceType === "STANDALONE") {
    await Invoice.updateOne({ _id: invoice._id }, { $inc: { adjustmentTotal: toNumber(plan.delta) } });
  } else {
    // Booking invoices are rebuilt from the booking, so the adjustment changes the booking revenue basis.
    const booking = await Booking.findOne({ bookingReference: invoice.bookingReference });
    if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
    const snapshot = booking.pricingSnapshot || {};
    if (plan.type === "CREDIT_NOTE") snapshot.discountAmount = toNumber(money(snapshot.discountAmount).plus(plan.amount));
    else {
      snapshot.grossAmount = toNumber(money(snapshot.grossAmount).plus(plan.amount));
      snapshot.extraAmount = toNumber(money(snapshot.extraAmount).plus(plan.amount));
    }
    snapshot.finalPayable = toNumber(money(snapshot.finalPayable).plus(plan.delta));
    booking.amount = snapshot.finalPayable;
    booking.markModified("pricingSnapshot");
    await booking.save();
    await Invoice.updateOne({ _id: invoice._id }, { $inc: { adjustmentTotal: toNumber(plan.delta) } });
  }

  let journal = null;
  if (plan.recognized) {
    // Credit note on recognized revenue: reduce the receivable against refunds and allowances.
    const result = await ledger.postSourceEvent({
      event: {
        sourceModule: SOURCE_MODULE.BUSINESS_ACCOUNTING,
        sourceEntityType: "InvoiceAdjustment",
        sourceEntityId: String(adjustment._id),
        sourceReference: adjustment.adjustmentReference,
        postingType: GL_POSTING_TYPE.REFUND_APPROVAL,
        postingKey: idempotencyKey,
        postingDate: new Date(),
        description: `Credit note ${adjustment.adjustmentReference} on ${invoice.invoiceNumber}`,
        currency: plan.currency,
        lines: [
          { mappingKey: GL_MAPPING_KEY.REFUND_ALLOWANCE, debit: plan.amount.toFixed(2), bookingReference: invoice.bookingReference },
          { mappingKey: GL_MAPPING_KEY.ACCOUNTS_RECEIVABLE, credit: plan.amount.toFixed(2), bookingReference: invoice.bookingReference }
        ],
        sourceSnapshot: { adjustment: adjustment.toObject() }
      },
      auth,
      requestId
    });
    journal = result?.journal || null;
    await InvoiceAdjustment.updateOne({ _id: adjustment._id }, { $set: { journalEntryId: journal?._id || journal?.id || null, postingStatus: "POSTED" } });
  }

  const updated = await recomputeInvoice(await Invoice.findById(invoice._id).lean(), { requestId, reason: `Invoice ${plan.type.toLowerCase().replace("_", " ")} applied` });
  await audit({
    action: "invoice_adjustment_applied",
    entityType: "InvoiceAdjustment",
    entityId: adjustment._id,
    reference: invoice.invoiceNumber,
    auth,
    requestId,
    reason: token(input.reason),
    before: { total: summary.totalBefore, balance: summary.balanceBefore },
    after: { total: summary.totalAfter, balance: summary.balanceAfter, approvalId: token(input.approvalId) }
  });
  return { action: "applied", adjustment: await InvoiceAdjustment.findById(adjustment._id).lean(), invoice: updated, journal };
};

module.exports = {
  MANUAL_METHODS,
  applyInvoiceAdjustment,
  confirmStandaloneDelivery,
  createStandaloneInvoice,
  evaluateStandaloneRevenue,
  postStandaloneRevenue,
  recomputeInvoice,
  recordManualPayment,
  revenueRecognizedFor,
  voidManualPayment
};
