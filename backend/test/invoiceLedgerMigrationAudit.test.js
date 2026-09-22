const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyHistoricalCustomerAccounting } = require("../scripts/audit-invoice-ledger-migration");

test("business contribution postings are not customer AR or revenue evidence", () => {
  const result = classifyHistoricalCustomerAccounting({ businessContributionPostingCount: 99 });

  assert.equal(result.classification, "BUSINESS_CONTRIBUTION_ONLY");
  assert.equal(result.conversionAllowed, false);
  assert.ok(result.reasons.includes("BOOKING_NET_CONTRIBUTION_IS_NOT_CUSTOMER_SUBLEDGER_EVIDENCE"));
});

test("historical customer accounting remains blocked when evidence is incomplete", () => {
  const result = classifyHistoricalCustomerAccounting({
    customerInvoiceJournalCount: 1,
    customerPaymentJournalCount: 1,
    appliedAllocationCount: 1
  });

  assert.equal(result.classification, "CUSTOMER_AR_REVENUE_EVIDENCE_MISSING");
  assert.equal(result.conversionAllowed, false);
  assert.ok(result.reasons.includes("SERVICE_COMPLETION_EVIDENCE_MISSING"));
  assert.ok(result.reasons.includes("VERIFIED_PAYMENT_EVIDENCE_MISSING"));
});

test("complete evidence still requires historical backfill review", () => {
  const result = classifyHistoricalCustomerAccounting({
    customerInvoiceJournalCount: 1,
    customerPaymentJournalCount: 1,
    appliedAllocationCount: 1,
    serviceCompletionCount: 1,
    verifiedPaymentEvidenceCount: 1
  });

  assert.equal(result.classification, "HISTORICAL_BACKFILL_REVIEW_REQUIRED");
  assert.equal(result.conversionAllowed, false);
  assert.deepEqual(result.reasons, []);
});