const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateExpectedSettlement, summarizeSettlement, idempotency, createSettlementService } = require("../src/services/settlements");

test("known commission and fees calculate expected net with currency", () => {
  const result = calculateExpectedSettlement({ gross: { amount: "100", currency: "USD" }, commission: { amount: "20", currency: "USD" }, fees: { amount: "3", currency: "USD" }, currency: "USD" });
  assert.deepEqual(result.expectedNet, { amount: "77", currency: "USD" });
});

test("unknown commission never invents expected settlement", () => {
  assert.equal(calculateExpectedSettlement({ gross: { amount: "100", currency: "USD" }, currency: "USD" }).expectedNet, null);
});

test("cross-currency expectation is blocked without FX", () => {
  assert.equal(calculateExpectedSettlement({ gross: { amount: "100", currency: "USD" }, commission: { amount: "20", currency: "EUR" }, currency: "USD" }).reason, "CURRENCY_MISMATCH");
});

test("received is distinct from reconciled and exact match is reconciled", () => {
  assert.equal(summarizeSettlement({ expectedNet: { amount: "80", currency: "USD" }, received: { amount: "80", currency: "USD" }, allocated: null }).status, "RECEIVED");
  assert.equal(summarizeSettlement({ expectedNet: { amount: "80", currency: "USD" }, received: { amount: "80", currency: "USD" }, allocated: { amount: "80", currency: "USD" } }).status, "RECONCILED");
});

test("partial and over-allocation states are explicit", () => {
  assert.equal(summarizeSettlement({ expectedNet: { amount: "80", currency: "USD" }, received: { amount: "50", currency: "USD" }, allocated: { amount: "50", currency: "USD" } }).status, "PARTIALLY_RECEIVED");
  assert.equal(summarizeSettlement({ expectedNet: { amount: "80", currency: "USD" }, received: { amount: "80", currency: "USD" }, allocated: { amount: "90", currency: "USD" } }).reason, "OVER_ALLOCATED");
});

test("settlement identity is provider/reference scoped", () => {
  assert.equal(idempotency({ provider: "GYG", providerSettlementReference: "P-1", evidenceReference: "P-1" }), idempotency({ provider: "GYG", providerSettlementReference: "P-1", evidenceReference: "P-1" }));
  assert.notEqual(idempotency({ provider: "GYG", providerSettlementReference: "P-1", evidenceReference: "P-1" }), idempotency({ provider: "VIATOR", providerSettlementReference: "P-1", evidenceReference: "P-1" }));
});

test("settlement service replays idempotently and does not call accounting models", async () => {
  const rows = [];
  const model = {
    findOne: async () => rows[0] || null,
    create: async (input) => { const row = { _id: "s1", ...input }; rows.push(row); return row; }
  };
  const audit = { create: async (input) => input };
  const service = createSettlementService({ SettlementModel: model, AuditLogModel: audit });
  const input = { settlementReference: "GYG-P-1", provider: "GETYOURGUIDE", providerSettlementReference: "P-1", grossAmount: 100, grossCurrency: "USD", commissionAmount: 20, commissionCurrency: "USD", receivedAmount: 80, receivedCurrency: "USD", evidenceSource: "PROVIDER_STATEMENT", evidenceReference: "statement-1" };
  const first = await service.create({ input, auth: { id: "admin" } });
  const second = await service.create({ input, auth: { id: "admin" } });
  assert.equal(first.replay, false);
  assert.equal(second.replay, true);
  assert.equal(rows.length, 1);
});
