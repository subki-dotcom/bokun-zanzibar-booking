const test = require("node:test");
const assert = require("node:assert/strict");
const { previewImport, createSettlementService } = require("../src/services/settlements");

const settlementModel = (rows = []) => ({
  find: () => ({ select: () => ({ lean: async () => rows }) }),
  findOne: async () => null,
  create: async (input) => ({ _id: "s1", ...input })
});
const bookingModel = (rows = []) => ({
  find: () => ({ select: () => ({ lean: async () => rows }) })
});

test("valid CSV preview is ready and matches only by booking reference", async () => {
  const result = await previewImport({
    csv: "settlement_reference,provider,amount,currency,evidence_reference,booking_reference\nGYG-1,gyg,80,USD,statement-1,BR-1",
    SettlementModel: settlementModel(),
    BookingModel: bookingModel([{ _id: "b1", bookingReference: "BR-1", currency: "USD" }])
  });
  assert.equal(result.status, "READY");
  assert.equal(result.rows[0].classification, "READY");
  assert.equal(result.rows[0].bookingId, "b1");
});

test("preview detects duplicate rows, unknown bookings, and currency mismatch", async () => {
  const result = await previewImport({
    csv: "settlement_reference,provider,amount,currency,evidence_reference,booking_reference\nV-1,VIATOR,50,EUR,s-1,UNKNOWN\nV-1,VIATOR,50,EUR,s-2,BR-1",
    SettlementModel: settlementModel(),
    BookingModel: bookingModel([{ _id: "b1", bookingReference: "BR-1", currency: "USD" }])
  });
  assert.equal(result.summary.UNKNOWN_BOOKING, 1);
  assert.equal(result.summary.CURRENCY_MISMATCH, 1);
  assert.equal(result.summary.DUPLICATE, 1);
});

test("preview rejects invalid amounts and missing required columns", async () => {
  const invalid = await previewImport({ csv: "settlement_reference,provider,amount,currency,evidence_reference\nS-1,BANK,-1,USD,e-1", SettlementModel: settlementModel(), BookingModel: bookingModel() });
  assert.equal(invalid.rows[0].classification, "INVALID_AMOUNT");
  const missing = await previewImport({ csv: "provider,amount\nBANK,10", SettlementModel: settlementModel(), BookingModel: bookingModel() });
  assert.equal(missing.status, "INVALID");
  assert.ok(missing.missingColumns.includes("settlement_reference"));
});

test("import service uses idempotent settlement creation and never creates payments", async () => {
  const created = [];
  const service = createSettlementService({ SettlementModel: { find: () => ({ select: () => ({ lean: async () => [] }) }), findOne: async () => null, create: async (input) => { created.push(input); return input; } }, AuditLogModel: { create: async () => null } });
  const result = await service.previewImport({ csv: "settlement_reference,provider,amount,currency,evidence_reference\nS-1,BANK,10,USD,e-1", BookingModel: bookingModel(), SettlementModel: settlementModel() });
  assert.equal(result.status, "READY");
  const committed = await service.commitImport({ token: result.token, auth: { id: "admin" } });
  assert.equal(committed.committed, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].evidenceSource, "CSV_IMPORT");
});
