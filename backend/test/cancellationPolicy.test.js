const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TIMEZONE,
  calculateCancellationPolicy,
  getTravelStartDate
} = require("../src/services/cancellations/policy");
const { mapProduct } = require("../src/integrations/bokun/bokun.mapper");

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

test("extracts readable cancellation text when Bokun returns a structured policy object", () => {
  const result = calculateCancellationPolicy({
    booking,
    productSnapshot: {
      bokunProductId: "1001",
      cancellationPolicy: "[object Object]",
      rawBokunProduct: {
        cancellationPolicy: {
          title: "Flexible cancellation",
          description: "Full refund is available when cancelled at least 48 hours before departure."
        }
      }
    },
    amountPaid: 150,
    now: new Date("2026-08-01T06:00:00.000Z")
  });

  assert.equal(result.policySummary, "Full refund is available when cancelled at least 48 hours before departure.");
  assert.equal(result.isFreeCancellationAvailable, true);
  assert.doesNotMatch(result.policySummary, /\[object Object\]/i);
});

test("maps structured Bokun cancellation policy to customer-readable text", () => {
  const product = mapProduct({
    id: 1001,
    title: "Zanzibar tour",
    cancellationPolicy: {
      description: "Cancel up to 24 hours before departure for a full refund."
    }
  });

  assert.equal(product.cancellationPolicy, "Cancel up to 24 hours before departure for a full refund.");
});

test("calculates the real advanced Bokun penalty-rule policy", () => {
  const advancedPolicy = {
    bokunProductId: "1001",
    cancellationPolicy: "Standard Viator policy",
    rawBokunProduct: {
      cancellationPolicy: {
        title: "Standard Viator policy",
        policyType: "ADVANCED",
        penaltyRules: [
          { cutoffHours: 24, charge: 100, chargeType: "percentage", percentage: 100 },
          { cutoffHours: 24000, charge: 0, chargeType: "percentage", percentage: 0 }
        ]
      }
    }
  };
  const outsidePenaltyWindow = calculateCancellationPolicy({
    booking,
    productSnapshot: advancedPolicy,
    amountPaid: 150,
    now: new Date("2026-08-10T04:59:59.000Z")
  });
  const insidePenaltyWindow = calculateCancellationPolicy({
    booking,
    productSnapshot: advancedPolicy,
    amountPaid: 150,
    now: new Date("2026-08-11T17:00:00.000Z")
  });

  assert.equal(outsidePenaltyWindow.deadline, "2026-08-11T08:00:00+03:00");
  assert.equal(outsidePenaltyWindow.isFreeCancellationAvailable, true);
  assert.equal(outsidePenaltyWindow.estimatedRefundAmount, 150);
  assert.match(outsidePenaltyWindow.policySummary, /24 hours before departure/i);
  assert.equal(insidePenaltyWindow.isFreeCancellationAvailable, false);
  assert.equal(insidePenaltyWindow.estimatedCancellationFee, 150);
  assert.equal(insidePenaltyWindow.estimatedRefundAmount, 0);
});

test("maps advanced Bokun rules into customer-readable product policy text", () => {
  const product = mapProduct({
    id: 1001,
    title: "Zanzibar Transfers",
    cancellationPolicy: {
      title: "Standard Viator policy",
      policyType: "ADVANCED",
      penaltyRules: [
        { cutoffHours: 24, charge: 100, chargeType: "percentage", percentage: 100 },
        { cutoffHours: 24000, charge: 0, chargeType: "percentage", percentage: 0 }
      ]
    }
  });

  assert.match(product.cancellationPolicy, /Free cancellation is available until 24 hours before departure/i);
  assert.match(product.cancellationPolicy, /100% cancellation fee/i);
});
