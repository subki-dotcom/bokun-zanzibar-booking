const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Booking = require("../src/models/Booking");
const Payment = require("../src/models/Payment");
const PaymentAllocation = require("../src/models/PaymentAllocation");
const Invoice = require("../src/models/Invoice");
const Refund = require("../src/models/Refund");
const { buildRow } = require("../src/services/bookingReconciliation").__testables;
const { mapBokunSalesChannel } = require("../src/integrations/bokun/salesChannel.adapter");

const CHANNELS = ["CONFIRMED_RISER_DIRECT", "CONFIRMED_GETYOURGUIDE", "CONFIRMED_VIATOR", "CONFIRMED_OTHER", "UNKNOWN", "AMBIGUOUS"];
const COLLECTORS = ["PESAPAL", "DPO", "PAYPAL", "GETYOURGUIDE", "VIATOR", "OTHER", "UNKNOWN"];
const PAYMENT_STATUSES = ["PAID", "PARTIALLY_PAID", "UNPAID / PENDING", "PARTIALLY_REFUNDED", "REFUNDED", "UNKNOWN"];
const COMPATIBILITY = ["CANONICAL", "LEGACY_BUT_INTERPRETABLE", "MISSING_VERIFICATION_EVIDENCE", "MISSING_CURRENCY", "AMBIGUOUS", "NEEDS_MANUAL_REVIEW"];
const ACCOUNTING_TREATMENTS = ["UNCLASSIFIED", "AR_SETTLEMENT", "ADVANCE_PAYMENT", "CUSTOMER_DEPOSIT", "INVALID"];
const EXPECTED_DATABASE = "bokun_zanzibar_booking";
const token = (value) => String(value || "").trim();
const upper = (value) => token(value).toUpperCase();
const countMap = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));
const increment = (map, key) => { map[key] = (map[key] || 0) + 1; };
const arg = (name, fallback = "") => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] || fallback : fallback; };
const has = (value) => token(value) !== "";

const evidenceText = (booking) => [
  booking.rawChannelSource,
  booking.bokunImport?.rawSalesChannel,
  booking.bokunImport?.salesChannelSourceField,
  booking.externalChannelReference,
  booking.bokunExternalBookingReference,
  booking.rawBokunResponse?.booking?.channel?.title,
  booking.rawBokunResponse?.booking?.externalBookingEntityName,
  booking.rawBokunResponse?.booking?.externalBookingEntityCode
].filter(Boolean).join(" | ");

const classifyChannel = (booking) => {
  const existing = upper(booking.salesChannel);
  if (existing === "DIRECT_WEBSITE") return { classification: "CONFIRMED_RISER_DIRECT", evidenceType: "EXISTING_SALES_CHANNEL", reason: "CANONICAL_DIRECT_VALUE", confidence: "HIGH" };
  if (existing === "GETYOURGUIDE") return { classification: "CONFIRMED_GETYOURGUIDE", evidenceType: "EXISTING_SALES_CHANNEL", reason: "CANONICAL_GYG_VALUE", confidence: "HIGH" };
  if (existing === "VIATOR") return { classification: "CONFIRMED_VIATOR", evidenceType: "EXISTING_SALES_CHANNEL", reason: "CANONICAL_VIATOR_VALUE", confidence: "HIGH" };
  if (existing && existing !== "OTHER") return { classification: "CONFIRMED_OTHER", evidenceType: "EXISTING_SALES_CHANNEL", reason: "CANONICAL_NON_OTA_CHANNEL", confidence: "HIGH" };

  const raw = booking.rawBokunResponse || {};
  const mapped = mapBokunSalesChannel(raw, booking.bokunImport?.rawSalesChannel || booking.rawChannelSource || "");
  if (mapped.salesChannel === "GETYOURGUIDE") return { classification: "CONFIRMED_GETYOURGUIDE", evidenceType: `BOKUN_${mapped.sourceField}`, reason: "VERIFIED_BOKUN_CHANNEL", confidence: "HIGH" };
  if (mapped.salesChannel === "VIATOR") return { classification: "CONFIRMED_VIATOR", evidenceType: `BOKUN_${mapped.sourceField}`, reason: "VERIFIED_BOKUN_CHANNEL", confidence: "HIGH" };
  if (mapped.salesChannel === "DIRECT_WEBSITE" && (has(booking.externalChannelReference) || has(booking.rawChannelSource))) {
    return { classification: "CONFIRMED_RISER_DIRECT", evidenceType: `BOKUN_${mapped.sourceField}`, reason: "EXPLICIT_DIRECT_SOURCE", confidence: "MEDIUM" };
  }
  const text = evidenceText(booking).toLowerCase();
  if (/getyourguide|gyg/.test(text)) return { classification: "CONFIRMED_GETYOURGUIDE", evidenceType: "CHANNEL_TEXT_EVIDENCE", reason: "VERIFIED_CHANNEL_TOKEN", confidence: "MEDIUM" };
  if (/viator/.test(text)) return { classification: "CONFIRMED_VIATOR", evidenceType: "CHANNEL_TEXT_EVIDENCE", reason: "VERIFIED_CHANNEL_TOKEN", confidence: "MEDIUM" };
  if (existing === "OTHER" && !text) return { classification: "UNKNOWN", evidenceType: "NONE", reason: "OTHER_WITHOUT_CLASSIFYING_EVIDENCE", confidence: "NONE" };
  if (!existing) return { classification: text ? "AMBIGUOUS" : "UNKNOWN", evidenceType: text ? "MIXED_METADATA" : "NONE", reason: text ? "INSUFFICIENT_CHANNEL_PROOF" : "MISSING_SALES_CHANNEL", confidence: "NONE" };
  return { classification: "AMBIGUOUS", evidenceType: "MIXED_METADATA", reason: "OTHER_REQUIRES_REVIEW", confidence: "LOW" };
};

const classifyPaymentCompatibility = (payment) => {
  const currency = upper(payment.orderCurrency || payment.chargedCurrency || payment.accountingCurrency || payment.currency);
  const verified = upper(payment.verificationStatus) === "VERIFIED";
  const hasIdentity = has(payment.intentId) && (has(payment.providerTransactionId) || has(payment.orderTrackingId) || has(payment.merchantReference));
  if (!currency) return "MISSING_CURRENCY";
  if (!payment.verificationStatus) return hasIdentity ? "MISSING_VERIFICATION_EVIDENCE" : "NEEDS_MANUAL_REVIEW";
  if (!hasIdentity) return "AMBIGUOUS";
  if (verified && has(payment.orderAmount ?? payment.amount)) return "CANONICAL";
  if (verified) return "LEGACY_BUT_INTERPRETABLE";
  if (["PENDING", "FAILED", "MANUAL_REVIEW", "AMOUNT_MISMATCH", "CURRENCY_REVIEW_REQUIRED", "REFERENCE_MISMATCH", "PROVIDER_ERROR"].includes(upper(payment.verificationStatus))) return "LEGACY_BUT_INTERPRETABLE";
  return "NEEDS_MANUAL_REVIEW";
};

const classifyAccountingTreatment = (payment) => {
  const treatment = upper(payment.accountingTreatment);
  return ACCOUNTING_TREATMENTS.includes(treatment) ? treatment : treatment ? "INVALID" : "UNCLASSIFIED";
};

const currencyOfBooking = (booking) => upper(booking.transactionCurrency || booking.bookingPaymentCurrency || booking.currency || booking.pricingSnapshot?.currency);
const currencyOfPayment = (payment) => upper(payment.accountingCurrency || payment.chargedCurrency || payment.orderCurrency || payment.currency);
const currencyOfInvoice = (invoice) => upper(invoice?.transactionCurrency || invoice?.accountingCurrency || invoice?.currency);
const currencyOfBokun = (booking) => upper(booking.bookingPaymentCurrency || booking.bokunPaymentSnapshot?.currency || booking.rawBokunResponse?.booking?.currency);
const moneyKey = (value) => {
  const text = token(value);
  if (!text) return "";
  const [whole = "0", fraction = ""] = text.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
};
const classifyAllocationCoverage = (payment, allocation) => {
  if (upper(payment.status) !== "PAID" || upper(payment.verificationStatus) !== "VERIFIED") return "NOT_VERIFIED_PAID";
  if (!allocation) return "MISSING_APPLIED_ALLOCATION";
  const amount = payment.accountingAmount ?? payment.orderAmount ?? payment.amount;
  const matches = String(allocation.paymentId) === String(payment._id)
    && token(allocation.bookingReference) === token(payment.bookingReference)
    && moneyKey(allocation.amount) === moneyKey(amount)
    && upper(allocation.currency) === currencyOfPayment(payment);
  return matches ? "MATCHED_APPLIED_ALLOCATION" : "APPLIED_ALLOCATION_MISMATCH";
};

const auditBatch = async (bookings) => {
  const refs = bookings.map((booking) => booking.bookingReference).filter(Boolean);
  const ids = bookings.map((booking) => booking._id);
  const [payments, invoices, refunds] = await Promise.all([
    Payment.find({ bookingReference: { $in: refs } }).lean(),
    Invoice.find({ bookingReference: { $in: refs } }).lean(),
    Refund.find({ bookingId: { $in: ids } }).lean()
  ]);
  const allocations = await PaymentAllocation.find({ paymentId: { $in: payments.map((payment) => payment._id) }, status: "applied" }).lean();
  const allocationsByPaymentId = new Map(allocations.map((allocation) => [String(allocation.paymentId), allocation]));
  const paymentsByRef = new Map();
  payments.forEach((payment) => { const rows = paymentsByRef.get(payment.bookingReference) || []; rows.push(payment); paymentsByRef.set(payment.bookingReference, rows); });
  const invoicesByRef = new Map(invoices.map((invoice) => [invoice.bookingReference, invoice]));
  const refundsById = new Map();
  refunds.forEach((refund) => { const key = String(refund.bookingId); const rows = refundsById.get(key) || []; rows.push(refund); refundsById.set(key, rows); });

  return bookings.map((booking) => {
    const refPayments = paymentsByRef.get(booking.bookingReference) || [];
    const invoice = invoicesByRef.get(booking.bookingReference) || null;
    const row = buildRow({ booking, invoice, payments: refPayments, refunds: refundsById.get(String(booking._id)) || [], postings: [], journals: [], settlement: null });
    const channel = classifyChannel(booking);
    const paymentStatuses = { ...countMap(PAYMENT_STATUSES) };
    const paymentStatus = row.customerPayment.status === "UNPAID" ? "UNPAID / PENDING" : PAYMENT_STATUSES.includes(row.customerPayment.status) ? row.customerPayment.status : "UNKNOWN";
    increment(paymentStatuses, paymentStatus);
    const collector = COLLECTORS.includes(row.collector.code) ? row.collector.code : "OTHER" === row.collector.code ? "OTHER" : "UNKNOWN";
    const paymentCurrencies = [...new Set(refPayments.map(currencyOfPayment).filter(Boolean))];
    const bookingCurrency = currencyOfBooking(booking);
    const invoiceCurrency = currencyOfInvoice(invoice);
    const bokunCurrency = currencyOfBokun(booking);
    const mismatches = {
      bookingPayment: Boolean(bookingCurrency && paymentCurrencies.some((currency) => currency !== bookingCurrency)),
      bookingInvoice: Boolean(bookingCurrency && invoiceCurrency && invoiceCurrency !== bookingCurrency),
      bookingBokun: Boolean(bookingCurrency && bokunCurrency && bokunCurrency !== bookingCurrency)
    };
    return {
      bookingId: String(booking._id), bookingReference: booking.bookingReference, currentSalesChannel: booking.salesChannel || "", operationalSource: booking.operationalSource || "",
      channelAudit: channel, collector: { code: collector, evidenceSource: row.customerPayment.evidenceSource, provider: row.provider.code }, customerPayment: { status: paymentStatus, source: row.customerPayment.evidenceSource, directVerifiedPayment: refPayments.some((payment) => upper(payment.verificationStatus) === "VERIFIED"), otaBokunEvidence: row.customerPayment.source === "BOKUN" },
      currencies: { booking: bookingCurrency || null, payment: paymentCurrencies, invoice: invoiceCurrency || null, bokun: bokunCurrency || null, mismatches }, paymentCompatibility: refPayments.map((payment) => ({ paymentId: String(payment._id), classification: classifyPaymentCompatibility(payment), accountingTreatment: classifyAccountingTreatment(payment), provider: payment.provider || "", currency: currencyOfPayment(payment) || null })), allocationCoverage: refPayments.map((payment) => ({ paymentId: String(payment._id), status: classifyAllocationCoverage(payment, allocationsByPaymentId.get(String(payment._id))) }))
    };
  });
};

async function main() {
  if (process.argv.includes("--apply")) throw new Error("This audit is read-only; --apply is not supported.");
  if (!process.env.MONGO_URI) throw new Error("Missing required backend environment variable: MONGO_URI");
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, readPreference: "secondaryPreferred" });
  const databaseName = mongoose.connection.db?.databaseName || "";
  console.log(JSON.stringify({ connected: true, databaseName }));
  if (databaseName !== EXPECTED_DATABASE) {
    throw new Error(`Unexpected database name: ${databaseName || "unknown"}; expected ${EXPECTED_DATABASE}. Audit stopped.`);
  }
  const batchSize = Math.max(1, Math.min(500, Number(arg("--batch-size", "100"))));
  const query = {};
  const cursor = Booking.find(query).select("bookingReference salesChannel operationalSource rawChannelSource externalChannelReference bokunExternalBookingReference bokunImport bokunPaymentSnapshot bookingPaymentStatus bookingPaymentStatusSource bookingPaymentReportedAmount bookingPaymentEvidenceHash bookingPaymentCurrency transactionCurrency currency pricingSnapshot rawBokunResponse bokunBookingId bokunConfirmationCode amount _id").sort({ _id: 1 }).cursor({ batchSize });
  const report = { readOnly: true, generatedAt: new Date().toISOString(), databaseName, batchSize, scannedBookings: 0, scannedPayments: 0, salesChannel: { counts: countMap(CHANNELS), evidenceTypes: {}, reasonCodes: {} }, collector: { counts: countMap(COLLECTORS), evidenceSources: {} }, customerPayment: { counts: countMap(PAYMENT_STATUSES), directVerifiedPayment: 0, otaBokunEvidence: 0 }, currency: { booking: {}, payment: {}, invoice: {}, bokun: {}, mismatchCounts: { bookingPayment: 0, bookingInvoice: 0, bookingBokun: 0 }, missing: { booking: 0, payment: 0, invoice: 0, bokun: 0 }, ambiguous: 0 }, paymentCompatibility: { counts: countMap(COMPATIBILITY) }, accountingTreatment: { counts: countMap(ACCOUNTING_TREATMENTS) }, allocationCoverage: { counts: countMap(["NOT_VERIFIED_PAID", "MISSING_APPLIED_ALLOCATION", "MATCHED_APPLIED_ALLOCATION", "APPLIED_ALLOCATION_MISMATCH"]) }, rows: [] };
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const rows = await auditBatch(batch);
    rows.forEach((row) => {
      report.rows.push(row); report.scannedBookings += 1; report.scannedPayments += row.paymentCompatibility.length;
      increment(report.salesChannel.counts, row.channelAudit.classification); increment(report.salesChannel.evidenceTypes, row.channelAudit.evidenceType); increment(report.salesChannel.reasonCodes, row.channelAudit.reason);
      increment(report.collector.counts, row.collector.code); increment(report.collector.evidenceSources, row.collector.evidenceSource);
      increment(report.customerPayment.counts, row.customerPayment.status); if (row.customerPayment.directVerifiedPayment) report.customerPayment.directVerifiedPayment += 1; if (row.customerPayment.otaBokunEvidence) report.customerPayment.otaBokunEvidence += 1;
      ["booking", "invoice", "bokun"].forEach((key) => { const value = row.currencies[key]; if (value) increment(report.currency[key], value); else report.currency.missing[key] += 1; }); row.currencies.payment.forEach((value) => increment(report.currency.payment, value)); if (!row.currencies.payment.length) report.currency.missing.payment += 1;
      Object.entries(row.currencies.mismatches).forEach(([key, value]) => { if (value) report.currency.mismatchCounts[key] += 1; }); if (!row.currencies.booking && !row.currencies.invoice && !row.currencies.bokun) report.currency.ambiguous += 1;
      row.paymentCompatibility.forEach((payment) => { increment(report.paymentCompatibility.counts, payment.classification); increment(report.accountingTreatment.counts, payment.accountingTreatment); });
      row.allocationCoverage.forEach((payment) => increment(report.allocationCoverage.counts, payment.status));
    });
    batch = [];
  };
  for await (const booking of cursor) { batch.push(booking); if (batch.length >= batchSize) await flush(); }
  await flush();
  const output = arg("--output", ""); if (output) { const outputPath = path.resolve(process.cwd(), output); fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"); }
  console.log(JSON.stringify({ readOnly: true, scannedBookings: report.scannedBookings, scannedPayments: report.scannedPayments, salesChannel: report.salesChannel.counts, collector: report.collector.counts, customerPayment: report.customerPayment.counts, accountingTreatment: report.accountingTreatment.counts, allocationCoverage: report.allocationCoverage.counts, output: output || null }, null, 2));
  await mongoose.disconnect();
}

if (require.main === module) main().catch(async (error) => { console.error(error.message); await mongoose.disconnect().catch(() => {}); process.exitCode = 1; });
module.exports = { classifyChannel, classifyPaymentCompatibility, classifyAccountingTreatment, classifyAllocationCoverage, auditBatch };
