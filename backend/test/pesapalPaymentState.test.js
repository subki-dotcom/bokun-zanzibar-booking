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

test("recognizes a Tanzania mobile-money conversion when Pesapal reports the order currency", () => {
  const result = __testables.validatePesapalVerification({
    booking: {
      bookingReference: "ZNZ-TEST-TIGO",
      paymentTransactionId: "tracking-tigo",
      amount: 1,
      currency: "USD",
      pendingCheckout: {
        pesapalMerchantReference: "ZNZ-TEST-TIGO",
        pesapalRequestedAmount: 1,
        pesapalRequestedCurrency: "USD"
      }
    },
    orderTrackingId: "tracking-tigo",
    orderMerchantReference: "ZNZ-TEST-TIGO",
    verification: {
      isPaid: true,
      providerOrderTrackingId: "tracking-tigo",
      merchantReference: "ZNZ-TEST-TIGO",
      amount: 2643,
      currency: "USD",
      raw: { payment_method: "TIGOTZ" }
    }
  });

  assert.deepEqual(result, {
    accountingAmount: 1,
    accountingCurrency: "USD",
    providerAmount: 2643,
    providerCurrency: "TZS",
    currencyConverted: true
  });
});

test("does not treat an ordinary card amount mismatch as currency conversion", () => {
  assert.throws(
    () => __testables.validatePesapalVerification({
      booking: {
        bookingReference: "ZNZ-TEST-CARD",
        paymentTransactionId: "tracking-card",
        amount: 1,
        currency: "USD",
        pendingCheckout: {
          pesapalMerchantReference: "ZNZ-TEST-CARD",
          pesapalRequestedAmount: 1,
          pesapalRequestedCurrency: "USD"
        }
      },
      orderTrackingId: "tracking-card",
      orderMerchantReference: "ZNZ-TEST-CARD",
      verification: {
        isPaid: true,
        providerOrderTrackingId: "tracking-card",
        merchantReference: "ZNZ-TEST-CARD",
        amount: 2643,
        currency: "USD",
        raw: { payment_method: "VISA" }
      }
    }),
    (error) => error.code === "PESAPAL_VERIFIED_AMOUNT_MISMATCH"
  );
});

test("does not accept an implausible mobile-money conversion amount", () => {
  assert.throws(
    () => __testables.validatePesapalVerification({
      booking: {
        bookingReference: "ZNZ-TEST-TIGO-BAD-RATE",
        paymentTransactionId: "tracking-tigo-bad-rate",
        amount: 70,
        currency: "USD",
        pendingCheckout: {
          pesapalMerchantReference: "ZNZ-TEST-TIGO-BAD-RATE",
          pesapalRequestedAmount: 70,
          pesapalRequestedCurrency: "USD"
        }
      },
      orderTrackingId: "tracking-tigo-bad-rate",
      orderMerchantReference: "ZNZ-TEST-TIGO-BAD-RATE",
      verification: {
        isPaid: true,
        providerOrderTrackingId: "tracking-tigo-bad-rate",
        merchantReference: "ZNZ-TEST-TIGO-BAD-RATE",
        amount: 2643,
        currency: "USD",
        raw: { payment_method: "TIGOTZ" }
      }
    }),
    (error) => error.code === "PESAPAL_VERIFIED_AMOUNT_MISMATCH"
  );
});

test("detects checkout and Pesapal callback origins from different environments", () => {
  const mismatch = __testables.findPesapalCallbackOriginMismatch({
    checkoutOrigin: "http://127.0.0.1:5173",
    frontendOrigins: ["http://127.0.0.1:5173", "https://example.vercel.app"],
    successUrl: "https://example.vercel.app/payment-success",
    cancelUrl: "https://example.vercel.app/payment-failure"
  });
  const matching = __testables.findPesapalCallbackOriginMismatch({
    checkoutOrigin: "https://example.vercel.app",
    frontendOrigins: ["https://example.vercel.app"],
    successUrl: "https://example.vercel.app/payment-success",
    cancelUrl: "https://example.vercel.app/payment-failure"
  });

  assert.equal(mismatch.mismatches.length, 2);
  assert.deepEqual(matching.mismatches, []);
});

test("returns a terminal reconciliation result for a verified callback without a local booking", () => {
  const result = __testables.buildUnmatchedPesapalCallbackResult({
    orderMerchantReference: "ZNZ-ORPHAN-1",
    verification: {
      status: "COMPLETED",
      merchantReference: "ZNZ-ORPHAN-1",
      raw: { status_code: 1 }
    }
  });

  assert.equal(result.status, "paid_manual_review");
  assert.equal(result.publicStatus, "PAID");
  assert.equal(result.paymentStatus, "paid");
  assert.equal(result.bookingReference, "ZNZ-ORPHAN-1");
  assert.equal(result.reconciliationRequired, true);
  assert.equal(result.isTerminal, true);
  assert.equal(result.amountPaid, null);
});

test("rejects a mismatched merchant reference for an unmatched callback", () => {
  assert.throws(
    () => __testables.buildUnmatchedPesapalCallbackResult({
      orderMerchantReference: "ZNZ-CALLBACK",
      verification: {
        status: "COMPLETED",
        merchantReference: "ZNZ-PROVIDER",
        raw: { status_code: 1 }
      }
    }),
    (error) => error.code === "PESAPAL_MERCHANT_REFERENCE_MISMATCH"
  );
});
