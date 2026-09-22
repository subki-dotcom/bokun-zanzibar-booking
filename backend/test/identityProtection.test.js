process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/identity-protection-test";
process.env.JWT_SECRET ||= "identity-protection-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const Invoice = require("../src/models/Invoice");
const invoices = require("../src/services/invoices");
const webhookIdempotency = require("../src/services/webhookIdempotency");
const { buildAuditReport, classifySharedExternalChannelReferences } = require("../src/services/identityAudit");

const duplicateError = () => Object.assign(new Error("duplicate"), { code: 11000 });

test("concurrent invoice upserts resolve to one canonical booking invoice", async (t) => {
  const originalUpdate = Invoice.findOneAndUpdate;
  const originalFind = Invoice.findOne;
  t.after(() => { Invoice.findOneAndUpdate = originalUpdate; Invoice.findOne = originalFind; });
  let record = null;
  let sequence = 0;
  Invoice.findOneAndUpdate = async (query, update) => {
    await new Promise((resolve) => setImmediate(resolve));
    if (!record) record = { _id: "invoice-1", ...update.$setOnInsert, ...update.$set, toObject() { return { ...this, toObject: undefined }; } };
    else Object.assign(record, update.$set || {});
    sequence += 1;
    return record;
  };
  Invoice.findOne = async () => record;
  const input = { invoiceNumber: "INV-1", bookingReference: "BK-1", total: 200, currency: "USD" };
  const rows = await Promise.all([invoices.upsertInvoiceFromSnapshot(input), invoices.upsertInvoiceFromSnapshot(input)]);
  assert.equal(rows.length, 2);
  assert.equal(record._id, "invoice-1");
  assert.equal(sequence, 2);
});

test("same provider webhook event is claimed once and replay is accepted", async () => {
  const records = new Map();
  const EventModel = {
    async create(value) {
      if (records.has(value.eventKey)) throw duplicateError();
      const row = { _id: value.eventKey, status: "processing", ...value };
      records.set(value.eventKey, row);
      return row;
    },
    async findOne({ eventKey }) { return records.get(eventKey) || null; },
    async findOneAndUpdate() { return null; }
  };
  const [first, second] = await Promise.all([
    webhookIdempotency.claim({ provider: "paypal", eventId: "WH-1", EventModel }),
    webhookIdempotency.claim({ provider: "paypal", eventId: "WH-1", EventModel })
  ]);
  assert.equal([first, second].filter((row) => row.acquired).length, 1);
  assert.equal([first, second].filter((row) => row.replay).length, 1);
  assert.equal(records.size, 1);
});

test("identity migration declares provider-scoped identities and remains guarded", () => {
  const source = require("node:fs").readFileSync(require.resolve("../scripts/migrate-duplicate-identity-indexes.js"), "utf8");
  assert.match(source, /providerTransactionId/);
  assert.match(source, /providerRefundReference/);
  assert.match(source, /bokunBookingId_unique_nonempty/);
  assert.match(source, /bookingReference_unique_primary_invoice/);
  assert.match(source, /if \(report\.totalConflictGroups\)/);
  assert.doesNotMatch(source, /deleteMany|remove\(|drop\(/);
});

test("known channel entity references are informational and excluded from identity conflicts", () => {
  const cases = [
    ["260782", 48, "OTHER"],
    ["12298", 18, "GETYOURGUIDE"],
    ["12296", 15, "VIATOR"],
    ["Riser Tours & Safaris", 2, "DIRECT_WEBSITE"]
  ].map(([externalChannelReference, count, salesChannel]) => ({
    identity: { externalChannelReference }, count,
    records: Array.from({ length: count }, (_, index) => ({ _id: `${externalChannelReference}-${index}`, salesChannel }))
  }));
  const report = buildAuditReport({ externalChannelReferenceGroups: cases });
  assert.equal(report.sharedExternalChannelReferences.length, 4);
  assert.equal(report.channelReferenceInconsistencies.length, 0);
  assert.equal(report.totalConflictGroups, 0);
  assert.ok(report.sharedExternalChannelReferences.every((row) => row.issueCode === "SHARED_EXTERNAL_CHANNEL_IDENTIFIER"));
});

test("one external channel reference across unrelated channels is flagged for review", () => {
  const [row] = classifySharedExternalChannelReferences([{
    identity: { externalChannelReference: "shared-1" }, count: 2,
    records: [{ salesChannel: "VIATOR" }, { salesChannel: "GETYOURGUIDE" }]
  }]);
  assert.equal(row.issueCode, "CHANNEL_REFERENCE_INCONSISTENCY");
  assert.equal(row.classification, "NEEDS_MANUAL_REVIEW");
  assert.equal(row.isConflict, true);
  assert.deepEqual(row.channels, ["GETYOURGUIDE", "VIATOR"]);
});

test("canonical duplicate identities remain conflicts", () => {
  const duplicate = [{ identity: "duplicate", count: 2, records: [{}, {}] }];
  const report = buildAuditReport({
    bookingReferenceDuplicates: duplicate,
    bokunBookingIdDuplicates: duplicate,
    invoiceDuplicates: duplicate,
    providerTransactionDuplicates: duplicate,
    providerOrderDuplicates: duplicate,
    refundDuplicates: duplicate,
    webhookEventDuplicates: duplicate
  });
  assert.equal(report.totalConflictGroups, 7);
});
