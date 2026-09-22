const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const { runDuplicateAudit } = require("../src/services/identityAudit");

const indexes = [
  ["bookings", { bokunBookingId: 1 }, { unique: true, partialFilterExpression: { bokunBookingId: { $type: "string", $gt: "" } }, name: "bokunBookingId_unique_nonempty" }],
  ["invoices", { bookingReference: 1 }, { unique: true, name: "bookingReference_unique_primary_invoice" }],
  ["payments", { provider: 1, providerTransactionId: 1 }, { unique: true, partialFilterExpression: { providerTransactionId: { $type: "string", $gt: "" } }, name: "provider_transaction_unique_nonempty" }],
  ["payments", { provider: 1, orderTrackingId: 1 }, { unique: true, partialFilterExpression: { orderTrackingId: { $type: "string", $gt: "" } }, name: "provider_order_unique_nonempty" }],
  ["paymentallocations", { idempotencyKey: 1 }, { unique: true, name: "allocation_idempotency_unique" }],
  ["refunds", { provider: 1, providerRefundReference: 1 }, { unique: true, partialFilterExpression: { providerRefundReference: { $type: "string", $gt: "" } }, name: "provider_refund_unique_nonempty" }],
  ["refunds", { idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string", $gt: "" } }, name: "refund_idempotency_unique_nonempty" }],
  ["providerwebhookevents", { eventKey: 1 }, { unique: true, name: "eventKey_unique_provider_event" }]
];

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const report = await runDuplicateAudit();
  const plan = indexes.map(([collection, key, options]) => ({ collection, key, options, action: process.argv.includes("--apply") ? "CREATE" : "PLAN" }));
  if (report.totalConflictGroups) {
    console.log(JSON.stringify({ applied: false, refused: true, totalConflictGroups: report.totalConflictGroups, report }, null, 2));
    process.exitCode = 3;
    return;
  }
  if (!process.argv.includes("--apply")) { console.log(JSON.stringify({ applied: false, conflicts: 0, plan }, null, 2)); return; }
  for (const [collection, key, options] of indexes) await mongoose.connection.db.collection(collection).createIndex(key, options);
  console.log(JSON.stringify({ applied: true, conflicts: 0, indexes: plan }, null, 2));
};
run().then(() => mongoose.disconnect()).catch(async (error) => { console.error(error.message); await mongoose.disconnect().catch(() => {}); process.exitCode = 1; });
