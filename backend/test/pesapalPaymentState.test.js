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

test("normalizes pending, failed, cancelled, reversed, and indeterminate Pesapal responses", () => {
  assert.equal(resolvePesapalPaymentState({ status_code: 1 }, "PENDING"), "processing");
  assert.equal(resolvePesapalPaymentState({ status_code: 1 }, "DECLINED"), "failed");
  assert.equal(resolvePesapalPaymentState({ status_code: 1 }, "CANCELLED"), "cancelled");
  assert.equal(resolvePesapalPaymentState({ status_code: 1 }, "REVERSED"), "reversed");
  assert.equal(resolvePesapalPaymentState({ status_code: 0 }, "COMPLETED"), "verification_error");
});

test("maps verified payment results to safe public statuses", () => {
  assert.equal(
    __testables.resolvePublicPaymentStatus({
      status: "paid",
      bookingStatus: "paid_supplier_pending",
      paymentStatus: "paid",
      hasBokunBooking: false
    }),
    "PAID"
  );
  assert.equal(
    __testables.resolvePublicPaymentStatus({
      status: "processing",
      bookingStatus: "payment_pending",
      paymentStatus: "paid",
      hasBokunBooking: false,
      hasVerifiedPaidPayment: false
    }),
    "PENDING"
  );
  assert.equal(
    __testables.resolvePublicPaymentStatus({
      status: "paid",
      bookingStatus: "confirmed",
      paymentStatus: "paid",
      hasBokunBooking: true
    }),
    "CONFIRMED"
  );
  assert.equal(
    __testables.resolvePublicPaymentStatus({
      status: "failed",
      bookingStatus: "failed",
      paymentStatus: "failed"
    }),
    "FAILED"
  );
  assert.equal(
    __testables.resolvePublicPaymentStatus({
      status: "cancelled",
      bookingStatus: "failed",
      paymentStatus: "failed"
    }),
    "CANCELLED"
  );
  assert.equal(__testables.resolvePublicPaymentMessage("PENDING"), "Your payment is being processed. Please wait while we confirm it.");
});

test("includes paid amount in already processed Pesapal callback bookings", () => {
  const booking = __testables.toPaymentCallbackBooking({
    _id: "booking-1",
    bookingReference: "ZNZ-PAID-1",
    paymentStatus: "paid",
    bookingStatus: "confirmed",
    bokunBookingId: "98613320",
    bokunConfirmationCode: "VIA-98613320",
    invoiceSnapshot: { paymentStatus: "paid", amountPaid: 1 },
    currency: "USD",
    pendingCheckout: { paymentVerifiedAt: "2026-07-27T06:06:57.374Z" }
  });

  assert.equal(booking.amountPaid, 1);
  assert.equal(booking.currency, "USD");
  assert.equal(booking.invoiceStatus, "paid");
  assert.equal(booking.paidAt, "2026-07-27T06:06:57.374Z");
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

test("accounts for the original order currency when Pesapal completes a converted payment", () => {
  const result = __testables.validatePesapalVerification({
    booking: {
      bookingReference: "ZNZ-TEST-2",
      paymentTransactionId: "tracking-2",
      amount: 1,
      currency: "USD",
      pendingCheckout: { pesapalMerchantReference: "ZNZ-TEST-2" }
    },
    orderTrackingId: "tracking-2",
    orderMerchantReference: "ZNZ-TEST-2",
    verification: {
      isPaid: true,
      providerOrderTrackingId: "tracking-2",
      merchantReference: "ZNZ-TEST-2",
      amount: 2626,
      currency: "TZS"
    }
  });

  assert.deepEqual(result, {
    accountingAmount: 1,
    accountingCurrency: "USD",
    providerAmount: 2626,
    providerCurrency: "TZS",
    currencyConverted: true
  });
});
