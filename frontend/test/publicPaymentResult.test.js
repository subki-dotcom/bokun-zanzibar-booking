import test from "node:test";
import assert from "node:assert/strict";

import { shouldPollPaymentResult } from "../src/utils/publicPaymentResult.js";

test("stops polling when an unmatched callback needs reconciliation", () => {
  assert.equal(
    shouldPollPaymentResult({
      publicStatus: "PAID",
      reconciliationRequired: true,
      isTerminal: true
    }),
    false
  );
});

test("continues polling an ordinary paid booking until supplier confirmation", () => {
  assert.equal(
    shouldPollPaymentResult({
      publicStatus: "PAID",
      paymentStatus: "paid"
    }),
    true
  );
});
