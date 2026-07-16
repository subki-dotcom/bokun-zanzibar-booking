const test = require("node:test");
const assert = require("node:assert/strict");
const dayjs = require("dayjs");

const { calculateCancellationPolicy } = require("../src/services/bookingRequests/cancellationPolicy");

const booking = {
  travelDate: "2026-08-10",
  startTime: "12:00",
  amount: 200
};

test("returns a full refund when cancellation is at least 48 hours before travel", () => {
  const result = calculateCancellationPolicy({
    booking,
    now: dayjs("2026-08-08T11:59:00+03:00")
  });

  assert.equal(result.refundPercentage, 100);
  assert.equal(result.estimatedRefundAmount, 200);
  assert.equal(result.nonRefundableAmount, 0);
});

test("returns a partial refund between 24 and 48 hours before travel", () => {
  const result = calculateCancellationPolicy({
    booking,
    now: dayjs("2026-08-09T01:00:00+03:00")
  });

  assert.equal(result.refundPercentage, 50);
  assert.equal(result.estimatedRefundAmount, 100);
  assert.equal(result.nonRefundableAmount, 100);
});

test("returns no refund inside the 24 hour window", () => {
  const result = calculateCancellationPolicy({
    booking,
    now: dayjs("2026-08-09T13:00:00+03:00")
  });

  assert.equal(result.refundPercentage, 0);
  assert.equal(result.estimatedRefundAmount, 0);
  assert.equal(result.nonRefundableAmount, 200);
});
