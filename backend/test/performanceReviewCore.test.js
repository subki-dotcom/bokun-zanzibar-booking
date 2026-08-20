process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/performance-review-core-test";
process.env.JWT_SECRET ||= "performance-review-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REVIEW_STATUS,
  createPerformanceReviewService,
  __testables
} = require("../src/services/performanceReview");

test("index coverage uses Mongo compound-prefix semantics", () => {
  assert.equal(
    __testables.indexCoversPattern(
      { bookingReference: 1, status: 1, lastVerifiedAt: -1, updatedAt: -1 },
      { bookingReference: 1, status: 1 }
    ),
    true
  );

  assert.equal(
    __testables.indexCoversPattern(
      { provider: 1, bookingReference: 1, status: 1 },
      { bookingReference: 1, status: 1 }
    ),
    false
  );

  assert.equal(
    __testables.indexCoversPattern(
      { status: 1, paidAt: 1, createdAt: -1 },
      { status: 1, paidAt: -1, createdAt: -1 }
    ),
    false
  );
});

test("performance review recognizes critical finance and worker indexes declared on current schemas", () => {
  const service = createPerformanceReviewService({
    now: () => new Date("2026-08-20T09:00:00.000Z")
  });

  const coverage = service.getIndexCoverage();
  const byId = new Map(coverage.items.map((item) => [item.id, item]));

  [
    "payment_booking_verified_summary",
    "payment_cash_flow_paid_at",
    "invoice_receivables_aging",
    "refund_reconciliation_worker",
    "sync_log_history"
  ].forEach((id) => {
    assert.equal(byId.get(id)?.status, REVIEW_STATUS.COVERED, `${id} should be covered`);
  });

  assert.equal(coverage.items.some((item) => item.priority === "critical" && !item.covered), false);
  assert.equal(coverage.rules.doesNotApplyIndexes, true);
});

test("performance review reports reviewed migration guidance when a required index is missing", () => {
  const fakeModel = {
    collection: { name: "fake_docs" },
    schema: {
      indexes: () => [[{ status: 1 }, {}]]
    }
  };
  const service = createPerformanceReviewService({
    models: { Fake: fakeModel },
    patterns: [
      {
        id: "fake_missing_compound",
        model: "Fake",
        area: "test",
        priority: "high",
        evidence: "High-volume list filters by status and createdAt.",
        queryShape: { filter: ["status", "createdAt"], sort: ["createdAt"] },
        requiredIndex: { status: 1, createdAt: -1 }
      }
    ],
    now: () => new Date("2026-08-20T09:00:00.000Z")
  });

  const coverage = service.getIndexCoverage();

  assert.equal(coverage.status, "review_required");
  assert.equal(coverage.counts.migrationRequired, 1);
  assert.equal(coverage.items[0].status, REVIEW_STATUS.RECOMMENDED);
  assert.equal(coverage.items[0].migrationRequired, true);
  assert.match(coverage.items[0].recommendation, /reviewed migration/);
});
