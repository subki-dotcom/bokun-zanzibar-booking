process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/pesapal-verification-poller-test";
process.env.JWT_SECRET ||= "pesapal-verification-poller-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const { __testables } = require("../src/jobs/pesapalVerification.job");

const MINUTE = 60 * 1000;
const { decideVerification } = __testables;

test("a paid, failed, cancelled or reversed order is processed at once", () => {
  for (const paymentState of ["paid", "failed", "cancelled", "reversed"]) {
    assert.equal(decideVerification({ paymentState, ageMs: 4 * MINUTE }), "process");
  }
});

test("an order not paid yet is left alone while the guest may still be paying", () => {
  assert.equal(decideVerification({ paymentState: "processing", ageMs: 10 * MINUTE }), "wait");
  assert.equal(decideVerification({ paymentState: "verification_error", ageMs: 59 * MINUTE }), "wait");
});

test("an order never paid is closed after the give-up time", () => {
  assert.equal(decideVerification({ paymentState: "processing", ageMs: 61 * MINUTE }), "expire");
  assert.equal(decideVerification({ paymentState: "verification_error", ageMs: 20 * MINUTE, giveUpAfterMs: 15 * MINUTE }), "expire");
});
