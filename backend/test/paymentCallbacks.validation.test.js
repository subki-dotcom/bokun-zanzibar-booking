const test = require("node:test");
const assert = require("node:assert/strict");

const { paypalWebhookSchema } = require("../src/validators/payments/paypal.validation");
const { dpoCallbackSchema } = require("../src/validators/payments/dpo.validation");

test("accepts a PayPal webhook event payload", () => {
  const result = paypalWebhookSchema.safeParse({
    body: {
      id: "WH-123",
      event_type: "CHECKOUT.ORDER.APPROVED",
      resource: { id: "ORDER-123" }
    },
    query: {},
    params: {}
  });

  assert.equal(result.success, true);
});

test("accepts a DPO callback token from either request body or query", () => {
  const bodyResult = dpoCallbackSchema.safeParse({
    body: { TransactionToken: "DPO-TOKEN-123" },
    query: {},
    params: {}
  });
  const queryResult = dpoCallbackSchema.safeParse({
    body: {},
    query: { transactionToken: "DPO-TOKEN-456" },
    params: {}
  });

  assert.equal(bodyResult.success, true);
  assert.equal(queryResult.success, true);
});

test("rejects a DPO callback without a transaction token", () => {
  const result = dpoCallbackSchema.safeParse({
    body: {},
    query: {},
    params: {}
  });

  assert.equal(result.success, false);
});
