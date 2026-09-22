const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyChannel, classifyPaymentCompatibility, classifyAccountingTreatment, classifyAllocationCoverage } = require("../scripts/audit-phase2a-payment-domain");

test("historical channel audit does not infer Direct from a local payment", () => {
  const result = classifyChannel({ salesChannel: "", operationalSource: "LOCAL", rawChannelSource: "", rawBokunResponse: {} });
  assert.equal(result.classification, "UNKNOWN");
  assert.equal(result.reason, "MISSING_SALES_CHANNEL");
});

test("historical channel audit uses explicit Bókun reseller evidence", () => {
  assert.equal(classifyChannel({ salesChannel: "OTHER", rawBokunResponse: { booking: { channel: { title: "Viator" } } } }).classification, "CONFIRMED_VIATOR");
  assert.equal(classifyChannel({ salesChannel: "OTHER", rawBokunResponse: { booking: { channel: { title: "GetYourGuide" } } } }).classification, "CONFIRMED_GETYOURGUIDE");
});

test("payment compatibility audit never fabricates missing verification evidence", () => {
  assert.equal(classifyPaymentCompatibility({ intentId: "i-1", providerTransactionId: "t-1", amount: 70, currency: "USD", verificationStatus: "" }), "MISSING_VERIFICATION_EVIDENCE");
  assert.equal(classifyPaymentCompatibility({ intentId: "i-1", providerTransactionId: "t-1", amount: 70, currency: "" }), "MISSING_CURRENCY");
  assert.equal(classifyPaymentCompatibility({ intentId: "i-1", providerTransactionId: "t-1", amount: 70, currency: "USD", verificationStatus: "verified", orderAmount: 70 }), "CANONICAL");
});

test("allocation coverage audit distinguishes missing and matching applied allocations", () => {
  const payment = { _id: "p-1", bookingReference: "ZNZ-1", status: "paid", verificationStatus: "verified", accountingAmount: "70.00", accountingCurrency: "USD" };
  assert.equal(classifyAllocationCoverage(payment, null), "MISSING_APPLIED_ALLOCATION");
  assert.equal(classifyAllocationCoverage(payment, { paymentId: "p-1", bookingReference: "ZNZ-1", amount: "70", currency: "usd" }), "MATCHED_APPLIED_ALLOCATION");
  assert.equal(classifyAllocationCoverage(payment, { paymentId: "p-1", bookingReference: "ZNZ-1", amount: "71", currency: "USD" }), "APPLIED_ALLOCATION_MISMATCH");
});

test("accounting treatment audit preserves missing evidence", () => {
  assert.equal(classifyAccountingTreatment({}), "UNCLASSIFIED");
  assert.equal(classifyAccountingTreatment({ accountingTreatment: "CUSTOMER_DEPOSIT" }), "CUSTOMER_DEPOSIT");
  assert.equal(classifyAccountingTreatment({ accountingTreatment: "unapproved-treatment" }), "INVALID");
});
