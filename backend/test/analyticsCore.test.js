process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/analytics-core-test";
process.env.JWT_SECRET ||= "analytics-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ANALYTICS_COMPARE_MODE,
  ANALYTICS_DATE_DIMENSION,
  ANALYTICS_PERIOD,
  ANALYTICS_RANGE_BOUNDARY,
  buildDateDimensionMatch,
  describeDateDimension,
  listDateDimensions,
  resolveAnalyticsPeriod,
  resolveComparisonPeriod,
  safePercentageChange
} = require("../src/analytics");

const fixedNow = new Date("2026-08-15T10:30:00.000Z");

test("resolves standard periods using Zanzibar local-day boundaries", () => {
  const today = resolveAnalyticsPeriod({
    period: ANALYTICS_PERIOD.TODAY,
    now: fixedNow
  });
  const month = resolveAnalyticsPeriod({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    now: fixedNow
  });
  const week = resolveAnalyticsPeriod({
    period: ANALYTICS_PERIOD.THIS_WEEK,
    now: fixedNow
  });

  assert.equal(today.boundary, ANALYTICS_RANGE_BOUNDARY);
  assert.equal(today.fromIso, "2026-08-14T21:00:00.000Z");
  assert.equal(today.toIso, "2026-08-15T21:00:00.000Z");
  assert.equal(month.fromIso, "2026-07-31T21:00:00.000Z");
  assert.equal(month.toIso, "2026-08-31T21:00:00.000Z");
  assert.equal(week.fromIso, "2026-08-09T21:00:00.000Z");
  assert.equal(week.toIso, "2026-08-16T21:00:00.000Z");
});

test("custom date-only period includes the visible to-date through an exclusive next-day boundary", () => {
  const range = resolveAnalyticsPeriod({
    period: ANALYTICS_PERIOD.CUSTOM,
    from: "2026-08-01",
    to: "2026-08-31",
    now: fixedNow
  });

  assert.equal(range.fromIso, "2026-07-31T21:00:00.000Z");
  assert.equal(range.toIso, "2026-08-31T21:00:00.000Z");
  assert.equal(range.isBounded, true);
});

test("multi-year period requires explicit bounds and lifetime remains visibly unbounded", () => {
  assert.throws(
    () => resolveAnalyticsPeriod({ period: ANALYTICS_PERIOD.MULTI_YEAR, now: fixedNow }),
    (error) => error.code === "ANALYTICS_MULTI_YEAR_RANGE_REQUIRED"
  );

  const lifetime = resolveAnalyticsPeriod({ period: ANALYTICS_PERIOD.LIFETIME, now: fixedNow });
  assert.equal(lifetime.isBounded, false);
  assert.equal(lifetime.fromIso, null);
  assert.equal(lifetime.toIso, null);
  assert.deepEqual(lifetime.warnings, ["LIFETIME_PERIOD_IS_UNBOUNDED"]);
});

test("comparison ranges support previous period and previous month without mutating current range", () => {
  const current = resolveAnalyticsPeriod({
    period: ANALYTICS_PERIOD.CUSTOM,
    from: "2026-08-01",
    to: "2026-08-31",
    now: fixedNow
  });
  const previousPeriod = resolveComparisonPeriod({
    currentRange: current,
    compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD
  });
  const previousMonth = resolveComparisonPeriod({
    currentRange: current,
    compare: ANALYTICS_COMPARE_MODE.PREVIOUS_MONTH
  });

  assert.equal(previousPeriod.range.fromIso, "2026-06-30T21:00:00.000Z");
  assert.equal(previousPeriod.range.toIso, "2026-07-31T21:00:00.000Z");
  assert.equal(previousMonth.range.fromIso, "2026-06-30T21:00:00.000Z");
  assert.equal(previousMonth.range.toIso, "2026-07-31T21:00:00.000Z");
  assert.equal(current.fromIso, "2026-07-31T21:00:00.000Z");
});

test("growth comparison never returns infinity when previous value is zero", () => {
  const invalid = safePercentageChange(120, 0);
  const valid = safePercentageChange(120, 100);

  assert.equal(invalid.percentageChange, null);
  assert.equal(invalid.comparisonValid, false);
  assert.equal(invalid.reason, "ZERO_PREVIOUS_VALUE");
  assert.equal(valid.percentageChange, 20);
  assert.equal(valid.comparisonValid, true);
});

test("date dimensions expose explicit source fields for analytics queries", () => {
  const current = resolveAnalyticsPeriod({
    period: ANALYTICS_PERIOD.CUSTOM,
    from: "2026-08-01",
    to: "2026-08-31",
    now: fixedNow
  });
  const paymentMatch = buildDateDimensionMatch({
    dateDimension: ANALYTICS_DATE_DIMENSION.PAYMENT_DATE,
    range: current,
    allowed: [ANALYTICS_DATE_DIMENSION.PAYMENT_DATE]
  });
  const travelDimension = describeDateDimension(ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE);
  const visibleDimensions = listDateDimensions();

  assert.deepEqual(Object.keys(paymentMatch), ["paidAt"]);
  assert.equal(paymentMatch.paidAt.$gte.toISOString(), "2026-07-31T21:00:00.000Z");
  assert.equal(paymentMatch.paidAt.$lt.toISOString(), "2026-08-31T21:00:00.000Z");
  assert.equal(travelDimension.mongoDateField, "bokunOperationalDates.travelDate.normalizedAt");
  assert.equal(travelDimension.mongoLocalDateField, "bokunOperationalDates.travelDate.localDate");
  assert.ok(visibleDimensions.some((dimension) => dimension.key === ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE));
});

test("date dimension guard rejects dimensions that are not allowed for a report", () => {
  const current = resolveAnalyticsPeriod({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    now: fixedNow
  });

  assert.throws(
    () => buildDateDimensionMatch({
      dateDimension: ANALYTICS_DATE_DIMENSION.EXPENSE_DATE,
      range: current,
      allowed: [ANALYTICS_DATE_DIMENSION.PAYMENT_DATE]
    }),
    (error) => error.code === "ANALYTICS_DATE_DIMENSION_NOT_ALLOWED"
  );
});
