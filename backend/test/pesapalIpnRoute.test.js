const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/pesapal-ipn-route-test";
process.env.JWT_SECRET ||= "pesapal-ipn-route-test-secret";
process.env.PESAPAL_MOCK_MODE = "true";

const app = require("../src/app");
const pesapalService = require("../src/services/payments/pesapal");
const refundsService = require("../src/services/refunds");

test("does not reject the Pesapal IPN route because of public-site CORS", async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { port } = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/payments/pesapal/ipn`,
      {
        method: "OPTIONS",
        headers: { Origin: "https://pay.pesapal.com" }
      }
    );
    assert.equal(response.status, 200);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("Pesapal IPN triggers refund reconciliation by order tracking id", async () => {
  const originalVerifyPayment = pesapalService.verifyAndProcessPesapalPayment;
  const originalReconcileRefunds = refundsService.reconcilePesapalRefundsForTransaction;
  let paymentArgs = null;
  let refundArgs = null;

  pesapalService.verifyAndProcessPesapalPayment = async (args) => {
    paymentArgs = args;
    return { status: "paid", booking: { bookingReference: "ZNZ-IPN-REFUND" } };
  };
  refundsService.reconcilePesapalRefundsForTransaction = async (args) => {
    refundArgs = args;
    return { summary: { matchedRefunds: 1, finalized: 1 }, results: [{ refundId: "refund-1", status: "refunded" }] };
  };

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { port } = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/payments/pesapal/ipn`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://pay.pesapal.com" },
        body: JSON.stringify({
          OrderTrackingId: "TRACK-IPN-1",
          OrderMerchantReference: "ZNZ-IPN-REFUND"
        })
      }
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(paymentArgs.orderTrackingId, "TRACK-IPN-1");
    assert.equal(paymentArgs.source, "ipn");
    assert.equal(refundArgs.orderTrackingId, "TRACK-IPN-1");
    assert.equal(refundArgs.orderMerchantReference, "ZNZ-IPN-REFUND");
    assert.equal(refundArgs.source, "pesapal_ipn_reconciliation");
    assert.equal(payload.data.refundReconciliation.summary.finalized, 1);
  } finally {
    pesapalService.verifyAndProcessPesapalPayment = originalVerifyPayment;
    refundsService.reconcilePesapalRefundsForTransaction = originalReconcileRefunds;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
