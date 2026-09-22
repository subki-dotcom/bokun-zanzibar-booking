const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDirectAdvancePaymentPolicy } = require("../scripts/audit-phase2c1-accounting-policy");

test("customer deposit policy remains blocked without a dedicated mapping", () => {
  const result = buildDirectAdvancePaymentPolicy(false);
  assert.equal(result.decision, "CUSTOMER_DEPOSIT");
  assert.equal(result.confidence, "MISSING_INFRASTRUCTURE");
  assert.equal(result.account, null);
  assert.equal(result.approvalRequired, true);
});

test("customer deposit policy identifies the approved account only when mapped", () => {
  const result = buildDirectAdvancePaymentPolicy(true);
  assert.equal(result.confidence, "STRONGLY_SUPPORTED_RECOMMENDATION");
  assert.equal(result.account, "2030 CUSTOMER DEPOSITS");
});