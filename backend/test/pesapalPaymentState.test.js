const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isVerifiedPesapalPayment,
  resolvePesapalPaymentState
} = require("../src/integrations/pesapal/pesapal.utils");

test("requires Pesapal success status code and completed transaction status before payment is paid", () => {
  assert.equal(isVerifiedPesapalPayment({ status_code: 1 }, "COMPLETED"), true);
  assert.equal(isVerifiedPesapalPayment({ status_code: 0 }, "COMPLETED"), false);
  assert.equal(isVerifiedPesapalPayment({ status_code: 1 }, "PENDING"), false);
});

test("normalizes pending, failed, reversed, and indeterminate Pesapal responses", () => {
  assert.equal(resolvePesapalPaymentState({ status_code: 1 }, "PENDING"), "processing");
  assert.equal(resolvePesapalPaymentState({ status_code: 1 }, "DECLINED"), "failed");
  assert.equal(resolvePesapalPaymentState({ status_code: 1 }, "REVERSED"), "reversed");
  assert.equal(resolvePesapalPaymentState({ status_code: 0 }, "COMPLETED"), "verification_error");
});
