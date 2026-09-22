require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const Booking = require("../src/models/Booking");
const Invoice = require("../src/models/Invoice");
const JournalEntry = require("../src/models/JournalEntry");
const Payment = require("../src/models/Payment");
const PaymentAllocation = require("../src/models/PaymentAllocation");
const ServiceCompletion = require("../src/models/ServiceCompletion");
const AccountingPosting = require("../src/models/AccountingPosting");
const { toDecimal } = require("../src/utils/money");

const args = process.argv.slice(2);
const valueOf = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
};

const normalize = (value) => String(value || "").trim();
const money = (value) => {
  try {
    return toDecimal(value ?? 0);
  } catch {
    return null;
  }
};
const amountOf = (invoice) => invoice.totalAmount ?? invoice.total ?? 0;
const currencyOf = (invoice) => normalize(invoice.accountingCurrency || invoice.transactionCurrency || invoice.currency);

const classifyHistoricalCustomerAccounting = (evidence = {}) => {
  const businessContributionPostingCount = Number(evidence.businessContributionPostingCount || 0);
  const customerInvoiceJournalCount = Number(evidence.customerInvoiceJournalCount || 0);
  const customerPaymentJournalCount = Number(evidence.customerPaymentJournalCount || 0);
  const appliedAllocationCount = Number(evidence.appliedAllocationCount || 0);
  const serviceCompletionCount = Number(evidence.serviceCompletionCount || 0);
  const verifiedPaymentEvidenceCount = Number(evidence.verifiedPaymentEvidenceCount || 0);
  const missingEvidence = [];

  if (!customerInvoiceJournalCount) missingEvidence.push("CUSTOMER_INVOICE_JOURNAL_MISSING");
  if (!customerPaymentJournalCount) missingEvidence.push("CUSTOMER_PAYMENT_JOURNAL_MISSING");
  if (!appliedAllocationCount) missingEvidence.push("APPLIED_PAYMENT_ALLOCATION_MISSING");
  if (!serviceCompletionCount) missingEvidence.push("SERVICE_COMPLETION_EVIDENCE_MISSING");
  if (!verifiedPaymentEvidenceCount) missingEvidence.push("VERIFIED_PAYMENT_EVIDENCE_MISSING");

  if (businessContributionPostingCount && !customerInvoiceJournalCount && !customerPaymentJournalCount) {
    return {
      classification: "BUSINESS_CONTRIBUTION_ONLY",
      conversionAllowed: false,
      reasons: ["BOOKING_NET_CONTRIBUTION_IS_NOT_CUSTOMER_SUBLEDGER_EVIDENCE", ...missingEvidence]
    };
  }

  return {
    classification: missingEvidence.length ? "CUSTOMER_AR_REVENUE_EVIDENCE_MISSING" : "HISTORICAL_BACKFILL_REVIEW_REQUIRED",
    conversionAllowed: false,
    reasons: missingEvidence
  };
};

const classify = ({ invoice, booking, postedReferences }) => {
  const reasons = [];
  const invoiceReference = normalize(invoice.invoiceNumber || invoice.bookingReference);
  if (postedReferences.has(invoiceReference)) reasons.push("ALREADY_POSTED");
  if (!booking) reasons.push("BOOKING_NOT_FOUND");
  if (booking && !["confirmed"].includes(normalize(booking.bookingStatus).toLowerCase())) {
    reasons.push("BOOKING_NOT_CONFIRMED");
  }
  const currency = currencyOf(invoice);
  if (!currency) reasons.push("ACCOUNTING_CURRENCY_MISSING");
  const invoiceAmount = money(amountOf(invoice));
  if (!invoiceAmount || !invoiceAmount.greaterThan(0)) reasons.push("INVOICE_AMOUNT_INVALID");
  if (booking) {
    const bookingAmount = money(booking.pricingSnapshot?.finalPayable ?? booking.amount);
    if (bookingAmount && invoiceAmount && !bookingAmount.equals(invoiceAmount)) reasons.push("BOOKING_INVOICE_TOTAL_MISMATCH");
  }
  return {
    action: reasons.length ? "NEEDS_REVIEW" : "ELIGIBLE_FOR_REVIEW",
    reasons,
    invoiceNumber: invoice.invoiceNumber,
    bookingReference: invoice.bookingReference,
    issueDate: invoice.issueDate || invoice.createdAt || null,
    bookingStatus: booking?.bookingStatus || invoice.bookingStatus || "",
    paymentStatus: invoice.paymentStatus || "",
    accountingCurrency: currency,
    invoiceAmount: invoiceAmount?.toFixed() || "0",
    bookingAmount: booking ? money(booking.pricingSnapshot?.finalPayable ?? booking.amount)?.toFixed() || "0" : null
  };
};

async function main() {
  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const [invoices, entries, businessContributionPostingCount, customerInvoiceJournalCount, customerPaymentJournalCount, appliedAllocationCount, serviceCompletionCount, verifiedPaymentEvidenceCount] = await Promise.all([
    Invoice.find({}).lean(),
    JournalEntry.find({ status: "POSTED", "source.sourceModule": "INVOICE" }).select("source").lean(),
    AccountingPosting.countDocuments({ postingType: "BOOKING_NET_CONTRIBUTION" }),
    JournalEntry.countDocuments({ status: "POSTED", "source.postingType": "CUSTOMER_INVOICE" }),
    JournalEntry.countDocuments({ status: "POSTED", "source.postingType": "CUSTOMER_PAYMENT" }),
    PaymentAllocation.countDocuments({ status: "applied", invoiceId: { $ne: null } }),
    ServiceCompletion.countDocuments({ status: { $in: ["COMPLETED", "PARTIALLY_COMPLETED"] } }),
    Payment.countDocuments({
      verificationStatus: "verified",
      status: "paid",
      $or: [
        { providerTransactionId: { $exists: true, $nin: ["", null] } },
        { confirmationCode: { $exists: true, $nin: ["", null] } },
        { orderTrackingId: { $exists: true, $nin: ["", null] } }
      ]
    })
  ]);
  const references = invoices.map((invoice) => invoice.bookingReference).filter(Boolean);
  const bookings = await Booking.find({ bookingReference: { $in: references } }).lean();
  const bookingsByReference = new Map(bookings.map((booking) => [booking.bookingReference, booking]));
  const postedReferences = new Set(entries.map((entry) => normalize(entry.source?.sourceReference)));
  const rows = invoices.map((invoice) => classify({ invoice, booking: bookingsByReference.get(invoice.bookingReference), postedReferences }));
  const summary = rows.reduce((result, row) => {
    result[row.action] = (result[row.action] || 0) + 1;
    row.reasons.forEach((reason) => { result.byReason[reason] = (result.byReason[reason] || 0) + 1; });
    return result;
  }, { ELIGIBLE_FOR_REVIEW: 0, NEEDS_REVIEW: 0, byReason: {} });
  const historicalCustomerAccountingEvidence = {
    businessContributionPostingCount,
    customerInvoiceJournalCount,
    customerPaymentJournalCount,
    appliedAllocationCount,
    serviceCompletionCount,
    verifiedPaymentEvidenceCount,
    ...classifyHistoricalCustomerAccounting({
      businessContributionPostingCount,
      customerInvoiceJournalCount,
      customerPaymentJournalCount,
      appliedAllocationCount,
      serviceCompletionCount,
      verifiedPaymentEvidenceCount
    })
  };
  const report = {
    readOnly: true,
    mode: "dry-run",
    generatedAt: new Date().toISOString(),
    database: mongoose.connection.db.databaseName,
    invoiceCount: invoices.length,
    postedInvoiceJournalCount: entries.length,
    summary,
    historicalCustomerAccountingEvidence,
    rows
  };
  const output = valueOf("--output");
  if (output) {
    const outputPath = path.resolve(process.cwd(), output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    report.output = outputPath;
  }
  console.log(JSON.stringify({
    mode: report.mode,
    database: report.database,
    invoiceCount: report.invoiceCount,
    postedInvoiceJournalCount: report.postedInvoiceJournalCount,
    summary,
    historicalCustomerAccountingEvidence,
    output: report.output || null
  }, null, 2));
}

if (require.main === module) main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

module.exports = { classifyHistoricalCustomerAccounting };
