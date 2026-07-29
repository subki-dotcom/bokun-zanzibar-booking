const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TIMEZONE,
  calculateCancellationPolicy,
  getTravelStartDate
} = require("../src/services/cancellations/policy");

const booking = {
  bokunProductId: "1001",
  bokunOptionId: "2001",
  bokunBookingId: "3001",
  travelDate: "2026-08-12",
  startTime: "08:00",
  amount: 150,
  currency: "USD"
};

const productSnapshot = {
  bokunProductId: "1001",
  cancellationPolicy: "Full refund is available when cancelled at least 48 hours before departure.",
  rawBokunProduct: {
    cancellationPolicy: "Full refund is available when cancelled at least 48 hours before departure."
  }
};

test("calculates Zanzibar travel start using timezone-aware server logic", () => {
  const travelStart = getTravelStartDate(booking);
  assert.equal(travelStart.toISOString(), "2026-08-12T05:00:00.000Z");
});

test("returns full refund at the exact free-cancellation deadline", () => {
  const result = calculateCancellationPolicy({
    booking,
    productSnapshot,
    amountPaid: 150,
    now: new Date("2026-08-10T05:00:00.000Z")
  });

  assert.equal(result.timezone, TIMEZONE);
  assert.equal(result.deadline, "2026-08-10T08:00:00+03:00");
  assert.equal(result.isFreeCancellationAvailable, true);
  assert.equal(result.estimatedRefundAmount, 150);
  assert.equal(result.estimatedCancellationFee, 0);
});

test("does not guess a late-cancellation refund when Bokun gives only a free cutoff", () => {
  const result = calculateCancellationPolicy({
    booking,
    productSnapshot,
    amountPaid: 150,
    now: new Date("2026-08-10T05:00:01.000Z")
  });

  assert.equal(result.isFreeCancellationAvailable, false);
  assert.equal(result.requiresManualReview, true);
  assert.equal(result.estimatedRefundAmount, null);
  assert.match(result.reviewReason, /ended/i);
});

test("returns manual review when no Bokun cancellation policy is available", () => {
  const result = calculateCancellationPolicy({
    booking,
    productSnapshot: { bokunProductId: "1001" },
    amountPaid: 150,
    now: new Date("2026-08-01T06:00:00.000Z")
  });

  assert.equal(result.policyAvailable, false);
  assert.equal(result.requiresManualReview, true);
  assert.equal(result.estimatedRefundAmount, null);
});

test("handles non-refundable Bokun policy without inventing a refund", () => {
  const result = calculateCancellationPolicy({
    booking,
    productSnapshot: {
      bokunProductId: "1001",
      cancellationPolicy: "This product is non-refundable after booking."
    },
    amountPaid: 150,
    now: new Date("2026-08-01T06:00:00.000Z")
  });

  assert.equal(result.refundable, false);
  assert.equal(result.estimatedRefundAmount, 0);
  assert.equal(result.estimatedCancellationFee, 150);
});
