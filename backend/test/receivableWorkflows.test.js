process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/receivable-workflows-test";
process.env.JWT_SECRET ||= "receivable-workflows-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const AccountingMapping = require("../src/models/AccountingMapping");
const ChartOfAccount = require("../src/models/ChartOfAccount");
const { __testables: bookingAccounting } = require("../src/services/bookingAccounting");
const customerAccounting = require("../src/services/customerAccounting");
const { createSettlementAccountingService } = require("../src/services/settlementAccounting");
const receivables = require("../src/services/customerReceivables");

const lean = (value) => ({ lean: async () => value });

test("a booking without recorded costs has no cost currency, so its verified revenue is not voided as an FX mismatch", () => {
  const counted = (currency) => ({ status: "APPROVED", accountingScope: "BOOKING_ACCOUNTING", currency, baseCurrency: currency, amount: 10 });
  assert.equal(bookingAccounting.bookingCostCurrency([], "USD"), "");
  assert.equal(bookingAccounting.bookingCostCurrency([counted("USD"), counted("USD")], "USD"), "USD");
  assert.equal(bookingAccounting.bookingCostCurrency([counted("USD"), counted("TZS")], "USD"), "MIXED");
});

test("cash, bank-transfer and mobile-money receipts have clearing accounts", async () => {
  const originals = { mapping: AccountingMapping.findOne, account: ChartOfAccount.findOne };
  try {
    AccountingMapping.findOne = () => lean(null);
    ChartOfAccount.findOne = () => lean({ code: "1010", active: true });
    for (const provider of ["cash_on_arrival", "manual_bank", "mobile_money"]) {
      const blockers = await customerAccounting.paymentEvidenceBlockers({
        payment: { provider, paymentMethod: "CASH", accountingCurrency: "USD", providerTransactionId: "RCPT-1" },
        allocation: { invoiceId: "invoice-1" }
      });
      assert.deepEqual(blockers, [], provider);
    }
  } finally {
    AccountingMapping.findOne = originals.mapping;
    ChartOfAccount.findOne = originals.account;
  }
});

const otaHarness = ({ allocations = [], recognition = { status: "POSTED" }, receivableLines = [], received = "80" } = {}) => createSettlementAccountingService({
  SettlementModel: {},
  AllocationModel: { find: () => lean(allocations) },
  PaymentModel: { find: () => lean([]) },
  PeriodModel: { findOne: () => lean({ status: "OPEN" }) },
  // OTA receivable accounts are an owner configuration; there is no default mapping for them.
  MappingModel: { findOne: () => lean({ mappingKey: "GYG_RECEIVABLE", accountCode: "1191", active: true }) },
  AccountModel: { findOne: () => lean({ code: "1191", subtype: "ACCOUNTS_RECEIVABLE", active: true }) },
  JournalModel: { findOne: () => lean(null) },
  LineModel: { find: () => lean(receivableLines) },
  RecognitionModel: { findOne: () => lean(recognition) },
  config: { ACCOUNTING_BASE_CURRENCY: "USD", CUSTOMER_PAYMENT_AUTOMATIC_POSTING_ENABLED: false }
}).evaluate;

const gygSettlement = (overrides = {}) => ({
  _id: "settlement-1",
  provider: "GETYOURGUIDE",
  status: "RECEIVED",
  received: { amount: "80", currency: "USD" },
  settlementDate: new Date("2026-10-08T10:00:00Z"),
  ...overrides
});

test("an OTA payout posts only against recognized supplier-net receivables it fully allocates", async () => {
  const allocation = { bookingReference: "GYG-1", amount: "80", status: "APPLIED" };
  const openReceivable = [{ baseCurrencyDebit: "80", baseCurrencyCredit: "0" }];

  const ready = await otaHarness({ allocations: [allocation], receivableLines: openReceivable })({ settlement: gygSettlement() });
  assert.deepEqual(ready.blockers, []);

  const unallocated = await otaHarness({ allocations: [] })({ settlement: gygSettlement() });
  assert.ok(unallocated.blockers.includes("SETTLEMENT_ALLOCATION_REQUIRED"));
  assert.ok(unallocated.blockers.includes("OTA_SETTLEMENT_NOT_FULLY_ALLOCATED"));

  const notRecognized = await otaHarness({ allocations: [allocation], recognition: null })({ settlement: gygSettlement() });
  assert.ok(notRecognized.blockers.includes("OTA_REVENUE_NOT_RECOGNIZED"));

  const tooLarge = await otaHarness({ allocations: [{ ...allocation, amount: "90" }], receivableLines: openReceivable })({ settlement: gygSettlement({ received: { amount: "90", currency: "USD" } }) });
  assert.ok(tooLarge.blockers.includes("OTA_ALLOCATION_EXCEEDS_RECEIVABLE"));
});

test("manual payments reject invalid method, missing idempotency key and missing evidence before touching data", async () => {
  await assert.rejects(() => receivables.recordManualPayment({ input: { method: "CHEQUE" } }), (error) => error.code === "MANUAL_PAYMENT_METHOD_INVALID");
  await assert.rejects(() => receivables.recordManualPayment({ input: { method: "CASH", evidenceReference: "R-1" } }), (error) => error.code === "IDEMPOTENCY_KEY_REQUIRED");
  await assert.rejects(() => receivables.recordManualPayment({ input: { method: "CASH", idempotencyKey: "k" } }), (error) => error.code === "PAYMENT_EVIDENCE_REQUIRED");
});

test("standalone invoices require an idempotency key", async () => {
  await assert.rejects(() => receivables.createStandaloneInvoice({ input: {} }), (error) => error.code === "IDEMPOTENCY_KEY_REQUIRED");
});
