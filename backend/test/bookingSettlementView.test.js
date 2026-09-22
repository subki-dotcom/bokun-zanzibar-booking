const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeSettlement, loadSettlementViews } = require("../src/services/bookingPayment/settlementView");

const payment = (extra = {}) => ({ _id: "p1", provider: "dpo", verificationStatus: "verified", ...extra });
const allocation = (extra = {}) => ({ _id: "a1", paymentId: "p1", status: "applied", amount: "100", currency: "USD", ...extra });

test("external customer paid without local receipts leaves settlement pending and cash zero", () => {
  const view = summarizeSettlement([], [], { currency: "USD", customerPaymentStatus: "PAID", balanceDue: 100 });
  assert.equal(view.status, "PENDING");
  assert.equal(view.receivedAmount, 0);
  assert.equal(view.currency, "USD");
  assert.equal(view.expectedAmount, null);
  assert.equal(view.cashReceipt.status, "NONE");
});
test("verified gateway capture and allocation do not prove cash settlement", () => {
  const view = summarizeSettlement([payment({ settlementAmount: "97", settlementCurrency: "USD" })], [allocation()]);
  assert.equal(view.status, "PENDING");
  assert.deepEqual(view.allocatedByCurrency, [{ amount: "100", currency: "USD" }]);
  assert.equal(view.cashReceipt.amount, 0);
});
test("dated verified net settlement is received without comparing gross invoice amount", () => {
  const view = summarizeSettlement([payment({ settledAt: "2026-09-09", settlementAmount: "97", settlementCurrency: "USD", providerFeeAmount: "3", providerFeeCurrency: "USD" })], [allocation()], { balanceDue: 100 });
  assert.equal(view.status, "RECEIVED");
  assert.equal(view.receivedAmount, "97");
  assert.deepEqual(view.providerFeesByCurrency, [{ amount: "3", currency: "USD" }]);
});
test("manual receipts require verification and applied allocations, with duplicate protection", () => {
  const paid = payment({ provider: "manual_bank" });
  const view = summarizeSettlement([paid, paid], [allocation(), allocation(), allocation({ _id: "a2", status: "reversed" })]);
  assert.equal(view.receivedAmount, "100");
  assert.equal(summarizeSettlement([payment({ provider: "manual_bank", verificationStatus: "pending" })], [allocation()]).status, "PENDING");
});
test("external gross 100 with fee 20 and net settlement 80 is received without gross equality", () => {
  const view = summarizeSettlement([payment({
    amount: 100, currency: "USD", settledAt: "2026-09-09",
    settlementAmount: "80", settlementCurrency: "USD",
    providerFeeAmount: "20", providerFeeCurrency: "USD"
  })], [allocation()], { invoiceTotal: 100, customerPaidAmount: 100, currency: "USD" });
  assert.equal(view.status, "RECEIVED");
  assert.equal(view.cashReceipt.status, "CONFIRMED");
  assert.equal(view.receivedAmount, "80");
  assert.equal(view.expectedAmount, null);
  assert.deepEqual(view.providerFeesByCurrency, [{ amount: "20", currency: "USD" }]);
});
test("partial state uses only explicit net expectation in same currency", () => {
  const payments = [payment({ provider: "cash_on_arrival" })];
  assert.equal(summarizeSettlement(payments, [allocation()], { expectedAmount: 150, currency: "USD" }).status, "PARTIALLY_RECEIVED");
  assert.equal(summarizeSettlement(payments, [allocation()], { expectedAmount: 150, currency: "EUR" }).status, "RECEIVED");
});
test("multiple receipt currencies remain separate without invented FX", () => {
  const view = summarizeSettlement([payment({ provider: "manual_bank" })], [allocation(), allocation({ _id: "a2", amount: "25", currency: "EUR" })]);
  assert.equal(view.receivedAmount, null);
  assert.equal(view.currency, null);
  assert.equal(view.receivedByCurrency.length, 2);
});
test("review flag is not reconciliation and missing settlement amount remains unknown", () => {
  const view = summarizeSettlement([payment({ settledAt: "2026-09-09", reconciliation: { reviewed: true } })]);
  assert.equal(view.receivedAmount, null);
  assert.equal(view.reconciliation.supported, false);
  assert.equal(view.reconciliation.status, "UNAVAILABLE");
  assert.equal(view.reviewedPaymentCount, 1);
});
test("empty batch does not access database", async () => {
  assert.equal((await loadSettlementViews([])).size, 0);
});
test("missing settlement amount or currency never becomes an invented zero USD receipt", () => {
  for (const fields of [{}, { settlementAmount: "80" }, { settlementCurrency: "USD" }]) {
    const view = summarizeSettlement([payment({ settledAt: "2026-09-09", ...fields })]);
    assert.equal(view.receivedAmount, null);
    assert.equal(view.currency, null);
    assert.equal(view.expectedAmount, null);
    assert.equal(view.expectedCurrency, null);
    assert.deepEqual(view.receivedByCurrency, []);
  }
});
test("batch projection groups references using two bounded reads and applies context currency", async () => {
  const Payment = require("../src/models/Payment");
  const PaymentAllocation = require("../src/models/PaymentAllocation");
  const Settlement = require("../src/models/Settlement");
  const SettlementAllocation = require("../src/models/SettlementAllocation");
  const originalPaymentFind = Payment.find;
  const originalAllocationFind = PaymentAllocation.find;
  const originalSettlementFind = Settlement.find;
  const originalSettlementAllocationFind = SettlementAllocation.find;
  const calls = [];
  const query = (rows) => ({ select: () => ({ lean: async () => rows }) });
  try {
    Payment.find = (filter) => {
      calls.push(filter);
      return query([payment({ bookingReference: "B1", provider: "manual_bank" })]);
    };
    PaymentAllocation.find = (filter) => {
      calls.push(filter);
      return query([allocation({ bookingReference: "B1" })]);
    };
    SettlementAllocation.find = (filter) => {
      calls.push(filter);
      return query([]);
    };
    Settlement.find = (filter) => {
      calls.push(filter);
      return query([]);
    };
    const views = await loadSettlementViews(["B1", "B2", "B1", ""], new Map([["B2", { currency: "TZS" }]]));
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0].bookingReference.$in, ["B1", "B2"]);
    assert.equal(views.get("B1").receivedAmount, "100");
    assert.equal(views.get("B2").receivedAmount, 0);
    assert.equal(views.get("B2").currency, "TZS");
    assert.equal(views.size, 2);
  } finally {
    Payment.find = originalPaymentFind;
    PaymentAllocation.find = originalAllocationFind;
    Settlement.find = originalSettlementFind;
    SettlementAllocation.find = originalSettlementAllocationFind;
  }
});
