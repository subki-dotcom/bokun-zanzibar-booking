const test = require("node:test");
const assert = require("node:assert/strict");
const { customerPaymentStatusSchema } = require("../src/validators/payments/pesapal.validation");

test("accepts a customer Pesapal status request with an order tracking ID", () => {
  const result = customerPaymentStatusSchema.safeParse({
    query: {
      OrderTrackingId: "31c7cb1c-4eb8-4bbc-b53a-da222a2f34e7"
    }
  });

  assert.equal(result.success, true);
});

test("accepts a customer Pesapal status request with a merchant reference", () => {
  const result = customerPaymentStatusSchema.safeParse({
    query: {
      OrderMerchantReference: "ZNZ-1784267117123-3526"
    }
  });

  assert.equal(result.success, true);
});

test("rejects a customer payment status request without a payment reference", () => {
  const result = customerPaymentStatusSchema.safeParse({
    query: {}
  });

  assert.equal(result.success, false);
});
