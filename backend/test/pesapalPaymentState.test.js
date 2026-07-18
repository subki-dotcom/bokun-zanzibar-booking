process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/pesapal-payment-state-test";
process.env.JWT_SECRET ||= "pesapal-payment-state-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isVerifiedPesapalPayment,
  resolvePesapalPaymentState
} = require("../src/integrations/pesapal/pesapal.utils");
const { __testables } = require("../src/services/payments/pesapal");

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

test("keeps amount mismatches blocked and records both values for reconciliation", () => {
  assert.throws(
    () =>
      __testables.validatePesapalVerification({
        booking: {
          bookingReference: "ZNZ-TEST-1",
          paymentTransactionId: "tracking-1",
          amount: 70,
          currency: "USD",
          pendingCheckout: { pesapalMerchantReference: "ZNZ-TEST-1" }
        },
        orderTrackingId: "tracking-1",
        orderMerchantReference: "ZNZ-TEST-1",
        verification: {
          isPaid: true,
          providerOrderTrackingId: "tracking-1",
          merchantReference: "ZNZ-TEST-1",
          amount: 80,
          currency: "USD"
        }
      }),
    (error) =>
      error.code === "PESAPAL_VERIFIED_AMOUNT_MISMATCH" &&
      error.details.expectedAmount === 70 &&
      error.details.verifiedAmount === 80
  );
});
