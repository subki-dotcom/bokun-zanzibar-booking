process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/multi-currency-payments-test";
process.env.JWT_SECRET ||= "multi-currency-payments-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  add,
  divide,
  equalsWithin,
  normalizeCurrency,
  requireCurrency
} = require("../src/utils/money");
const { sanitizeProviderPayload } = require("../src/services/payments");
const { __testables: dpo } = require("../src/services/payments/dpo");
const { __testables: paypal } = require("../src/services/payments/paypal");
const { __testables: pesapal } = require("../src/services/payments/pesapal");
const { normalizePesapalPayment } = require("../src/services/payments/providerNormalization");

const dpoBooking = {
  bookingReference: "ZNZ-DPO-1",
  dpoTransactionToken: "dpo-token-1",
  amount: 1,
  currency: "USD"
};

const dpoVerification = (overrides = {}) => ({
  isPaid: true,
  resultCode: "000",
  transactionStatus: "Paid",
  transactionToken: "dpo-token-1",
  transactionRef: "ZNZ-DPO-1",
  transactionFinalAmount: "1.00",
  transactionFinalCurrency: "USD",
  ...overrides
});

const paypalVerification = (overrides = {}) => ({
  isPaid: true,
  orderId: "PAYPAL-ORDER-1",
  captureId: "PAYPAL-CAPTURE-1",
  amount: "1.00",
  currency: "USD",
  status: "COMPLETED",
  raw: {
    id: "PAYPAL-ORDER-1",
    status: "COMPLETED",
    purchase_units: [{
      custom_id: "ZNZ-PAYPAL-1",
      payments: { captures: [{ id: "PAYPAL-CAPTURE-1", status: "COMPLETED", amount: { value: "1.00", currency_code: "USD" } }] }
    }]
  },
  ...overrides
});

test("performs decimal money arithmetic without binary floating-point drift", () => {
  assert.equal(add("0.10", "0.20"), "0.3");
  assert.equal(divide("2626", "1"), "2626");
  assert.equal(equalsWithin("1.000", "1.004", "0.005"), true);
  assert.equal(equalsWithin("1.000", "1.006", "0.005"), false);
});

test("accepts strict ISO currencies and isolates display aliases", () => {
  assert.equal(normalizeCurrency("usd"), "USD");
  assert.equal(normalizeCurrency("KSH"), "");
  assert.equal(normalizeCurrency("KSH", { allowDisplayAlias: true }), "KES");
  assert.throws(() => requireCurrency("US"), (error) => error.code === "INVALID_CURRENCY");
});

test("accepts verified DPO cross-currency money and derives historical FX", () => {
  const result = dpo.validateDpoVerification({
    booking: dpoBooking,
    verification: dpoVerification({ transactionFinalAmount: "2626", transactionFinalCurrency: "TZS" }),
    transactionToken: "dpo-token-1"
  });
  assert.equal(result.verificationStatus, "verified");
  assert.equal(result.providerAmount, "2626");
  assert.equal(result.providerCurrency, "TZS");
  assert.equal(result.accountingAmount, "1");
  assert.equal(result.fxRate, "2626");
  assert.equal(result.canAllocate, true);
});

test("blocks a same-currency DPO amount mismatch", () => {
  const result = dpo.validateDpoVerification({
    booking: dpoBooking,
    verification: dpoVerification({ transactionFinalAmount: "2.00" }),
    transactionToken: "dpo-token-1"
  });
  assert.equal(result.verificationStatus, "amount_mismatch");
  assert.equal(result.canAllocate, false);
});

test("rejects a DPO verification with a different merchant reference", () => {
  assert.throws(
    () => dpo.validateDpoVerification({
      booking: dpoBooking,
      verification: dpoVerification({ transactionRef: "ZNZ-OTHER" }),
      transactionToken: "dpo-token-1"
    }),
    (error) => error.code === "DPO_REFERENCE_MISMATCH"
  );
});

test("accepts a completed PayPal USD capture with exact immutable references", () => {
  const result = paypal.validatePaypalVerification({
    booking: { bookingReference: "ZNZ-PAYPAL-1", paymentTransactionId: "PAYPAL-ORDER-1", amount: 1, currency: "USD" },
    verification: paypalVerification()
  });
  assert.equal(result.verificationStatus, "verified");
  assert.equal(result.providerAmount, "1");
  assert.equal(result.providerCurrency, "USD");
  assert.equal(result.canAllocate, true);
});

test("blocks PayPal capture amount and currency mismatches", () => {
  const booking = { bookingReference: "ZNZ-PAYPAL-1", paymentTransactionId: "PAYPAL-ORDER-1", amount: 1, currency: "USD" };
  const amountMismatch = paypal.validatePaypalVerification({
    booking,
    verification: paypalVerification({ amount: "2.00" })
  });
  const currencyMismatch = paypal.validatePaypalVerification({
    booking,
    verification: paypalVerification({ currency: "EUR" })
  });
  assert.equal(amountMismatch.verificationStatus, "amount_mismatch");
  assert.equal(currencyMismatch.verificationStatus, "currency_review_required");
  assert.equal(amountMismatch.canAllocate, false);
  assert.equal(currencyMismatch.canAllocate, false);
});

test("accepts local mock success payloads with immutable references and order money", () => {
  const dpoResult = dpo.validateDpoVerification({
    booking: { bookingReference: "ZNZ-MOCK-DPO", dpoTransactionToken: "MOCKDPO-1", amount: 70, currency: "USD" },
    transactionToken: "MOCKDPO-1",
    verification: {
      isPaid: true,
      resultCode: "000",
      transactionStatus: "PAID",
      transactionToken: "MOCKDPO-1",
      transactionRef: "ZNZ-MOCK-DPO",
      transactionFinalAmount: "70.00",
      transactionFinalCurrency: "USD",
      rawXml: "<mock />"
    }
  });
  const paypalResult = paypal.validatePaypalVerification({
    booking: { bookingReference: "ZNZ-MOCK-PAYPAL", paymentTransactionId: "MOCKPAYPAL-1", amount: 70, currency: "USD" },
    verification: {
      isPaid: true,
      orderId: "MOCKPAYPAL-1",
      captureId: "MOCKCAPTURE-1",
      amount: "70.00",
      currency: "USD",
      status: "COMPLETED",
      raw: {
        id: "MOCKPAYPAL-1",
        status: "COMPLETED",
        purchase_units: [{
          custom_id: "ZNZ-MOCK-PAYPAL",
          payments: {
            captures: [{
              id: "MOCKCAPTURE-1",
              status: "COMPLETED",
              amount: { value: "70.00", currency_code: "USD" }
            }]
          }
        }]
      }
    }
  });
  const pesapalResult = pesapal.validatePesapalVerification({
    booking: {
      bookingReference: "ZNZ-MOCK-PESA",
      paymentTransactionId: "MOCKPESAPAL-1",
      amount: 70,
      currency: "USD",
      pendingCheckout: {
        pesapalMerchantReference: "ZNZ-MOCK-PESA",
        pesapalRequestedAmount: 70,
        pesapalRequestedCurrency: "USD"
      }
    },
    orderTrackingId: "MOCKPESAPAL-1",
    orderMerchantReference: "ZNZ-MOCK-PESA",
    verification: {
      isPaid: true,
      providerOrderTrackingId: "MOCKPESAPAL-1",
      merchantReference: "ZNZ-MOCK-PESA",
      confirmationCode: "MOCKPESA-1",
      amount: "70.00",
      currency: "USD",
      status: "COMPLETED",
      raw: { mock: true, status_code: 1 }
    }
  });

  assert.equal(dpoResult.verificationStatus, "verified");
  assert.equal(paypalResult.verificationStatus, "verified");
  assert.equal(pesapalResult.verificationStatus, "verified");
  assert.equal(dpoResult.canAllocate, true);
  assert.equal(paypalResult.canAllocate, true);
  assert.equal(pesapalResult.canAllocate, true);
});

test("does not manufacture a missing Pesapal charged currency", () => {
  const normalized = normalizePesapalPayment({
    isPaid: true,
    amount: "2626",
    currency: "KSH",
    providerOrderTrackingId: "tracking-1",
    confirmationCode: "confirmation-1"
  });
  assert.equal(normalized.chargedAmount, "2626");
  assert.equal(normalized.chargedCurrency, "");
  assert.equal(normalized.hasValidChargedMoney, false);
});

test("redacts provider secrets, account data, and full digit sequences", () => {
  const safe = sanitizeProviderPayload({
    access_token: "secret-token",
    payment_account: "255700000000",
    nested: { cardNumber: "4111111111111111", note: "Account 4111111111111111 charged" },
    order_tracking_id: "tracking-safe"
  });
  assert.equal(safe.access_token, "[redacted]");
  assert.equal(safe.payment_account, "[redacted]");
  assert.equal(safe.nested.cardNumber, "[redacted]");
  assert.equal(safe.nested.note, "Account ************1111 charged");
  assert.equal(safe.order_tracking_id, "tracking-safe");
});
