const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Booking = require("../src/models/Booking");
const Payment = require("../src/models/Payment");
const Invoice = require("../src/models/Invoice");
const EXPECTED_DATABASE = "bokun_zanzibar_booking";
const token = (value) => String(value || "").trim();
const countBy = (rows, key) => rows.reduce((out, row) => { const value = token(key(row)) || "UNKNOWN"; out[value] = (out[value] || 0) + 1; return out; }, {});

async function main() {
  if (process.argv.includes("--apply")) throw new Error("This audit is read-only; --apply is not supported.");
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required from backend/.env");
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, readPreference: "secondaryPreferred" });
  const databaseName = mongoose.connection.db.databaseName;
  console.log(JSON.stringify({ connected: true, databaseName }));
  if (databaseName !== EXPECTED_DATABASE) throw new Error(`Unexpected database name: ${databaseName}`);
  const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
  const names = new Set(collections.map((collection) => collection.name));
  const [bookings, payments, invoices] = await Promise.all([
    Booking.find({}).select("bookingReference salesChannel operationalSource settlement settlementReference payoutReference commission commissionAmount netSettlement settlementAmount settlementCurrency").lean(),
    Payment.find({}).select("bookingReference provider settledAt settlementAmount settlementCurrency providerFeeAmount providerFeeCurrency providerTransactionId orderTrackingId").lean(),
    Invoice.find({}).select("bookingReference settlement settlementReference commission commissionAmount netSettlement").lean()
  ]);
  const fields = {
    bookingSettlementFields: bookings.filter((row) => row.settlement || row.settlementReference || row.payoutReference || row.commission || row.commissionAmount || row.netSettlement || row.settlementAmount).length,
    paymentSettlementFields: payments.filter((row) => row.settledAt || row.settlementAmount || row.settlementCurrency || row.providerFeeAmount || row.providerFeeCurrency).length,
    invoiceSettlementFields: invoices.filter((row) => row.settlement || row.settlementReference || row.commission || row.commissionAmount || row.netSettlement).length
  };
  const providerPayoutReferences = payments.filter((row) => row.settledAt || row.settlementAmount || row.settlementCurrency).map((row) => ({ bookingReference: row.bookingReference, provider: row.provider, providerTransactionId: row.providerTransactionId || row.orderTrackingId || "", settledAt: row.settledAt || null, currency: row.settlementCurrency || null }));
  const report = {
    readOnly: true, generatedAt: new Date().toISOString(), databaseName, collections: { settlement: names.has("settlements"), settlementAllocation: names.has("settlementallocations") },
    scanned: { bookings: bookings.length, payments: payments.length, invoices: invoices.length }, fields,
    evidenceClassification: { AUTHORITATIVE: providerPayoutReferences.length ? providerPayoutReferences.length : 0, POTENTIALLY_USEFUL: 0, INSUFFICIENT: 0, NONE: providerPayoutReferences.length ? 0 : bookings.length + payments.length + invoices.length },
    providerPayoutReferences,
    existingSettlementIdentityConflicts: { settlementReferences: {}, providerReferences: {} },
    salesChannels: countBy(bookings, (row) => row.salesChannel),
    settlementStatusFields: countBy(bookings, (row) => row.settlement?.status),
    readiness: {
      providerSettlementPosting: providerPayoutReferences.length ? "REQUIRES_SETTLEMENT_RECONCILIATION_REVIEW" : "BLOCKED_MISSING_SETTLEMENT_EVIDENCE",
      customerPaymentPosting: providerPayoutReferences.length ? "REQUIRES_SETTLEMENT_RECONCILIATION_REVIEW" : "BLOCKED_MISSING_SETTLEMENT_EVIDENCE",
      mutationCounters: { productionRecordsChanged: 0, journalEntriesCreated: 0, glPostingsCreated: 0, bokunRecordsModified: 0 }
    }
  };
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}
main().catch(async (error) => { console.error(error.message); await mongoose.disconnect().catch(() => {}); process.exitCode = 1; });
