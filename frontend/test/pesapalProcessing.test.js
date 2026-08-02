import test from "node:test";
import assert from "node:assert/strict";

import { shouldStartPesapalStatusPolling } from "../src/utils/pesapalProcessing.js";

test("does not poll Pesapal before the customer returns from the gateway", () => {
  assert.equal(
    shouldStartPesapalStatusPolling({ gatewayReturned: false, hasGatewayReturnParams: false }),
    false
  );
});

test("starts Pesapal polling after an iframe or top-level gateway return", () => {
  assert.equal(
    shouldStartPesapalStatusPolling({ gatewayReturned: true, hasGatewayReturnParams: false }),
    true
  );
  assert.equal(
    shouldStartPesapalStatusPolling({ gatewayReturned: false, hasGatewayReturnParams: true }),
    true
  );
});
