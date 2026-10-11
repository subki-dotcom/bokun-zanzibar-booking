const test = require("node:test");
const assert = require("node:assert/strict");

const service = require("../src/services/customerAccounting");
const { env } = require("../src/config/env");
const Invoice = require("../src/models/Invoice");
const Payment = require("../src/models/Payment");
const PaymentAllocation = require("../src/models/PaymentAllocation");
const JournalEntry = require("../src/models/JournalEntry");
const JournalEntryLine = require("../src/models/JournalEntryLine");
const AccountingMapping = require("../src/models/AccountingMapping");
const ChartOfAccount = require("../src/models/ChartOfAccount");
const AccountingPeriod = require("../src/models/AccountingPeriod");
const ledger = require("../src/services/generalLedger/ledger");
const RevenueRecognition = require("../src/models/RevenueRecognition");


test("customer accounting uses stable source identities", () => {
  assert.equal(service.invoiceKey({ _id: "invoice-1" }), "customer-invoice:invoice-1:v1");
  assert.equal(service.paymentKey({ _id: "payment-1" }), "customer-payment:payment-1:v1");
  assert.notEqual(service.invoiceKey({ _id: "invoice-1" }), service.paymentKey({ _id: "invoice-1" }));
});

test("customer accounting states distinguish posting reservation from review", () => {
  assert.equal(service.STATES.POSTING, "POSTING");
  assert.equal(service.STATES.POSTING_BLOCKED, "POSTING_BLOCKED");
  assert.equal(service.STATES.FAILED_RETRYABLE, "FAILED_RETRYABLE");
});

test("payment evidence requires processor references and rejects unsupported clearing providers", async () => {
  const originals = {
    mappingFindOne: AccountingMapping.findOne,
    accountFindOne: ChartOfAccount.findOne
  };
  try {
    AccountingMapping.findOne = () => ({ lean: async () => null });
    ChartOfAccount.findOne = () => ({ lean: async () => ({ code: "1040", active: true }) });

    assert.deepEqual(await service.paymentEvidenceBlockers({
      payment: { provider: "PAYPAL", accountingCurrency: "USD" },
      allocation: { invoiceId: "invoice-1" }
    }), ["MISSING_PAYMENT_METHOD", "MISSING_PROCESSOR_REFERENCE"]);
    assert.deepEqual(await service.paymentEvidenceBlockers({
      payment: { provider: "PAYPAL", paymentMethod: "CARD", accountingCurrency: "USD", providerTransactionId: "paypal-tx" },
      allocation: { invoiceId: "invoice-1" }
    }), []);
    assert.deepEqual(await service.paymentEvidenceBlockers({
      payment: { provider: "UNKNOWN_PROCESSOR", paymentMethod: "CARD", accountingCurrency: "USD" },
      allocation: { invoiceId: "invoice-1" }
    }), ["MISSING_CLEARING_ACCOUNT"]);
  } finally {
    AccountingMapping.findOne = originals.mappingFindOne;
    ChartOfAccount.findOne = originals.accountFindOne;
  }
});

test("payment evidence blocks missing FX support and closed accounting periods", async () => {
  const originalPeriodFindOne = AccountingPeriod.findOne;
  try {
    AccountingPeriod.findOne = () => ({ lean: async () => ({ status: "CLOSED" }) });
    const blockers = await service.paymentEvidenceBlockers({
      payment: { accountingCurrency: "EUR", paidAt: new Date("2026-09-10T12:00:00Z") },
      allocation: { invoiceId: "invoice-1" }
    });
    assert.deepEqual(blockers, ["FX_POLICY_REQUIRED", "POSTING_BLOCKED_CLOSED_PERIOD"]);
  } finally {
    AccountingPeriod.findOne = originalPeriodFindOne;
  }
});

// Stubs the persistence the payment evaluation reads, restoring originals afterwards.
const withPaymentStubs = async ({ invoice = { _id: "invoice-1", bookingReference: "BR-1" }, allocation = null, recognition = null, recognitionJournal = null }, run) => {
  const originals = {
    invoiceFindOne: Invoice.findOne,
    allocationFindOne: PaymentAllocation.findOne,
    journalFindOne: JournalEntry.findOne,
    lineFind: JournalEntryLine.find,
    recognitionFindOne: RevenueRecognition.findOne,
    mappingFindOne: AccountingMapping.findOne,
    accountFindOne: ChartOfAccount.findOne
  };
  try {
    Invoice.findOne = () => ({ lean: async () => invoice });
    PaymentAllocation.findOne = () => ({ lean: async () => allocation });
    RevenueRecognition.findOne = () => ({ sort: () => ({ lean: async () => recognition }) });
    // Only the recognition journal exists; customer payment journals are absent unless a test says otherwise.
    JournalEntry.findOne = (query) => ({
      lean: async () => (recognitionJournal && String(query?._id) === String(recognitionJournal._id) ? recognitionJournal : null)
    });
    JournalEntryLine.find = () => ({ lean: async () => [{ _id: "line-1" }, { _id: "line-2" }] });
    AccountingMapping.findOne = () => ({ lean: async () => null });
    ChartOfAccount.findOne = () => ({ lean: async () => ({ code: "2030", active: true }) });
    return await run();
  } finally {
    Invoice.findOne = originals.invoiceFindOne;
    PaymentAllocation.findOne = originals.allocationFindOne;
    JournalEntry.findOne = originals.journalFindOne;
    JournalEntryLine.find = originals.lineFind;
    RevenueRecognition.findOne = originals.recognitionFindOne;
    AccountingMapping.findOne = originals.mappingFindOne;
    ChartOfAccount.findOne = originals.accountFindOne;
  }
};

const verifiedPayment = (overrides = {}) => ({
  _id: "payment-1",
  bookingReference: "BR-1",
  intentId: "intent-1",
  status: "paid",
  verificationStatus: "verified",
  accountingAmount: 100,
  accountingCurrency: "USD",
  ...overrides
});

const appliedAllocation = { _id: "allocation-1", paymentId: "payment-1", bookingReference: "BR-1", status: "applied", amount: "100", currency: "USD" };

test("a payment before revenue recognition is a customer deposit, not a receivable settlement", async () => {
  await withPaymentStubs({ allocation: appliedAllocation }, async () => {
    const result = await service.evaluatePayment({ payment: verifiedPayment() });
    assert.equal(result.treatment, service.TREATMENT.CUSTOMER_DEPOSIT);
    assert.equal(result.creditMappingKey, "CUSTOMER_DEPOSIT");
    // Real allocations carry no invoiceId; the booking's invoice is the association.
    assert.deepEqual(result.blockers, []);
  });
});

test("a payment after revenue recognition settles the receivable", async () => {
  await withPaymentStubs({
    allocation: appliedAllocation,
    recognition: { _id: "recognition-1", bookingReference: "BR-1", status: "POSTED", journalEntryId: "journal-r1" },
    recognitionJournal: { _id: "journal-r1", lineCount: 2 }
  }, async () => {
    const result = await service.evaluatePayment({ payment: verifiedPayment() });
    assert.equal(result.treatment, service.TREATMENT.SETTLE_RECEIVABLE);
    assert.equal(result.creditMappingKey, "ACCOUNTS_RECEIVABLE");
    assert.deepEqual(result.blockers, []);
  });
});

test("explicit advance payment treatment is accepted before recognition and blocked after it", async () => {
  await withPaymentStubs({ allocation: appliedAllocation }, async () => {
    const result = await service.evaluatePayment({ payment: verifiedPayment({ accountingTreatment: "ADVANCE_PAYMENT" }) });
    assert.equal(result.treatment, service.TREATMENT.CUSTOMER_DEPOSIT);
    assert.deepEqual(result.blockers, []);
  });
  await withPaymentStubs({
    allocation: appliedAllocation,
    recognition: { _id: "recognition-1", bookingReference: "BR-1", status: "POSTED", journalEntryId: "journal-r1" },
    recognitionJournal: { _id: "journal-r1", lineCount: 2 }
  }, async () => {
    const result = await service.postPayment({ payment: verifiedPayment({ accountingTreatment: "ADVANCE_PAYMENT" }) });
    assert.equal(result.action, "blocked");
    assert.deepEqual(result.eligibility.blockers, ["ADVANCE_PAYMENT_CLASSIFICATION_REQUIRED"]);
  });
});

test("verified customer payment remains preview-only while automatic posting is disabled", async () => {
  const originals = { paymentUpdateOne: Payment.updateOne, postCustomerPayment: ledger.postCustomerPayment };
  let updates = 0;
  let ledgerCalls = 0;
  try {
    assert.equal(env.CUSTOMER_PAYMENT_AUTOMATIC_POSTING_ENABLED, false);
    Payment.updateOne = async () => { updates += 1; };
    ledger.postCustomerPayment = async () => { ledgerCalls += 1; };
    await withPaymentStubs({ allocation: appliedAllocation }, async () => {
      const result = await service.postPayment({ payment: verifiedPayment() });
      assert.equal(result.action, "preview");
      assert.equal(result.eligibility.status, service.STATES.READY_TO_POST);
      assert.deepEqual(result.eligibility.blockers, []);
    });
    assert.equal(updates, 0);
    assert.equal(ledgerCalls, 0);
  } finally {
    Payment.updateOne = originals.paymentUpdateOne;
    ledger.postCustomerPayment = originals.postCustomerPayment;
  }
});

test("verified customer payment without an applied allocation is blocked", async () => {
  await withPaymentStubs({ allocation: null }, async () => {
    const result = await service.postPayment({ payment: verifiedPayment({ accountingCurrency: "" }) });
    assert.equal(result.action, "blocked");
    assert.equal(result.eligibility.status, service.STATES.POSTING_BLOCKED);
    assert.deepEqual(result.eligibility.blockers, ["PAYMENT_ALLOCATION_REQUIRED", "MISSING_PAYMENT_CURRENCY"]);
  });
});

test("verified customer payment with changed amount or currency is blocked", async () => {
  await withPaymentStubs({ allocation: appliedAllocation }, async () => {
    const result = await service.postPayment({ payment: verifiedPayment({ accountingAmount: 125 }) });
    assert.equal(result.action, "blocked");
    assert.deepEqual(result.eligibility.blockers, ["PAYMENT_ALLOCATION_MISMATCH"]);
  });
});

test("a payment whose booking has no invoice cannot be associated", async () => {
  await withPaymentStubs({ invoice: null, allocation: appliedAllocation }, async () => {
    const result = await service.evaluatePayment({ payment: verifiedPayment() });
    assert.deepEqual(result.blockers, ["PAYMENT_INVOICE_ASSOCIATION_REQUIRED", "INVOICE_NOT_FOUND"]);
  });
});

test("refund requests are never posted as cash; completed refunds return deposits before recognition", async () => {
  await withPaymentStubs({}, async () => {
    const requested = await service.evaluateRefund({
      refund: { _id: "refund-1", bookingReference: "BR-1", status: "processing", provider: "pesapal", currency: "USD", confirmedRefundedAmount: 0 }
    });
    assert.equal(requested.eligible, false);
    assert.equal(requested.blockers.includes("REFUND_NOT_COMPLETED"), true);
    assert.equal(requested.blockers.includes("CONFIRMED_REFUND_AMOUNT_REQUIRED"), true);

    const completed = await service.evaluateRefund({
      refund: { _id: "refund-1", bookingReference: "BR-1", status: "refunded", provider: "pesapal", currency: "USD", confirmedRefundedAmount: 40 }
    });
    assert.deepEqual(completed.blockers, []);
    assert.equal(completed.debitMappingKey, "CUSTOMER_DEPOSIT");
  });
});

test("incomplete customer invoice journal moves the invoice to needs review", async () => {
  const originals = {
    serviceCompletionFindOne: require("../src/models/ServiceCompletion").findOne,
    invoiceUpdateOne: Invoice.updateOne,
    journalFindOne: JournalEntry.findOne,
    lineFind: JournalEntryLine.find,
    mappingFindOne: AccountingMapping.findOne,
    accountFindOne: ChartOfAccount.findOne,
    periodFindOne: AccountingPeriod.findOne
  };
  let update;
  try {
    require("../src/models/ServiceCompletion").findOne = () => ({ sort: () => ({ lean: async () => ({ status: "COMPLETED", verifiedAt: new Date(), evidenceSource: "ADMIN_VERIFIED", completedAt: new Date() }) }) });
    Invoice.updateOne = async (_query, value) => { update = value; };
    JournalEntry.findOne = () => ({ lean: async () => ({ _id: "journal-1", lineCount: 2 }) });
    JournalEntryLine.find = () => ({ lean: async () => [] });
    AccountingMapping.findOne = () => ({ lean: async () => ({ accountCode: "1100", active: true }) });
    ChartOfAccount.findOne = () => ({ lean: async () => ({ code: "1100", active: true }) });
    AccountingPeriod.findOne = () => ({ lean: async () => ({ status: "OPEN" }) });

    const result = await service.postInvoice({
      invoice: { _id: "invoice-1", bookingReference: "BR-1", accountingCurrency: "USD", total: 100 },
      booking: { _id: "booking-1", bookingReference: "BR-1", salesChannel: "DIRECT_WEBSITE", bookingStatus: "confirmed", amount: 100 }
    });

    assert.equal(result.action, "blocked");
    assert.equal(result.eligibility.status, service.STATES.NEEDS_REVIEW);
    assert.deepEqual(update.$set.accountingBlockers, ["INCOMPLETE_JOURNAL"]);
  } finally {
    require("../src/models/ServiceCompletion").findOne = originals.serviceCompletionFindOne;
    Invoice.updateOne = originals.invoiceUpdateOne;
    JournalEntry.findOne = originals.journalFindOne;
    JournalEntryLine.find = originals.lineFind;
    AccountingMapping.findOne = originals.mappingFindOne;
    ChartOfAccount.findOne = originals.accountFindOne;
    AccountingPeriod.findOne = originals.periodFindOne;
  }
});