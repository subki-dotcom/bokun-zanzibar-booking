const test = require("node:test");
const assert = require("node:assert/strict");

const ledger = require("../src/services/generalLedger/ledger");

test("unknown provider does not fall back to the bank mapping", () => {
  assert.equal(ledger.__testables.providerMappingKey("UNKNOWN_PROVIDER"), null);
});

test("known processor providers retain dedicated clearing mappings", () => {
  assert.equal(ledger.__testables.providerMappingKey("pesapal"), "PESAPAL_CLEARING");
  assert.equal(ledger.__testables.providerMappingKey("paypal"), "PAYPAL_CLEARING");
  assert.equal(ledger.__testables.providerMappingKey("dpo"), "DPO_CLEARING");
});