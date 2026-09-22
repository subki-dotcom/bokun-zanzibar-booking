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

const invoiceJournalOnly = (query) => ({
  lean: async () => query?.["source.postingKey"] === service.paymentKey({ _id: "payment-1" })
    ? null
    : { _id: "journal-1", lineCount: 2 }
});

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

test("explicit advance payment treatment is blocked until deposit posting policy exists", async () => {
  const originals = {
    invoiceFindOne: Invoice.findOne,
    allocationFindOne: PaymentAllocation.findOne,
    journalFindOne: JournalEntry.findOne,
    lineFind: JournalEntryLine.find
  };
  try {
    Invoice.findOne = () => ({ lean: async () => ({ _id: "invoice-1", bookingReference: "BR-1" }) });
    PaymentAllocation.findOne = () => ({ lean: async () => ({ paymentId: "payment-1", bookingReference: "BR-1", status: "applied", amount: "100", currency: "USD" }) });
    JournalEntry.findOne = invoiceJournalOnly;
    JournalEntryLine.find = () => ({ lean: async () => [{ _id: "line-1" }, { _id: "line-2" }] });

    const result = await service.postPayment({
      payment: {
        _id: "payment-1",
        bookingReference: "BR-1",
        intentId: "intent-1",
        status: "paid",
        verificationStatus: "verified",
        accountingAmount: 100,
        accountingCurrency: "USD",
        accountingTreatment: "ADVANCE_PAYMENT"
      }
    });

    assert.equal(result.action, "blocked");
    assert.deepEqual(result.eligibility.blockers, ["ADVANCE_PAYMENT_CLASSIFICATION_REQUIRED", "PAYMENT_INVOICE_ASSOCIATION_REQUIRED"]);
  } finally {
    Invoice.findOne = originals.invoiceFindOne;
    PaymentAllocation.findOne = originals.allocationFindOne;
    JournalEntry.findOne = originals.journalFindOne;
    JournalEntryLine.find = originals.lineFind;
  }
});

test("verified customer payment remains preview-only while automatic posting is disabled", async () => {
  const originals = {
    invoiceFindOne: Invoice.findOne,
    allocationFindOne: PaymentAllocation.findOne,
    paymentUpdateOne: Payment.updateOne,
    journalFindOne: JournalEntry.findOne,
    lineFind: JournalEntryLine.find,
    postCustomerPayment: ledger.postCustomerPayment
  };
  let updates = 0;
  let ledgerCalls = 0;
  try {
    assert.equal(env.CUSTOMER_PAYMENT_AUTOMATIC_POSTING_ENABLED, false);
    Invoice.findOne = () => ({ lean: async () => ({ _id: "invoice-1", bookingReference: "BR-1" }) });
    PaymentAllocation.findOne = () => ({ lean: async () => ({ _id: "allocation-1", invoiceId: "invoice-1", paymentId: "payment-1", bookingReference: "BR-1", status: "applied", amount: "100", currency: "USD" }) });
    JournalEntry.findOne = invoiceJournalOnly;
    JournalEntryLine.find = () => ({ lean: async () => [{ _id: "line-1" }, { _id: "line-2" }] });
    Payment.updateOne = async () => { updates += 1; };
    ledger.postCustomerPayment = async () => { ledgerCalls += 1; };

    const result = await service.postPayment({
      payment: {
        _id: "payment-1",
        bookingReference: "BR-1",
        intentId: "intent-1",
        status: "paid",
        verificationStatus: "verified",
        accountingAmount: 100,
        accountingCurrency: "USD"
      }
    });

    assert.equal(result.action, "preview");
    assert.equal(result.eligibility.status, service.STATES.READY_TO_POST);
    assert.deepEqual(result.eligibility.blockers, []);
    assert.equal(updates, 0);
    assert.equal(ledgerCalls, 0);
  } finally {
    Invoice.findOne = originals.invoiceFindOne;
    PaymentAllocation.findOne = originals.allocationFindOne;
    Payment.updateOne = originals.paymentUpdateOne;
    JournalEntry.findOne = originals.journalFindOne;
    JournalEntryLine.find = originals.lineFind;
    ledger.postCustomerPayment = originals.postCustomerPayment;
  }
});

test("verified customer payment without an applied allocation is blocked", async () => {
  const originals = {
    invoiceFindOne: Invoice.findOne,
    allocationFindOne: PaymentAllocation.findOne,
    journalFindOne: JournalEntry.findOne,
    lineFind: JournalEntryLine.find
  };
  try {
    Invoice.findOne = () => ({ lean: async () => ({ _id: "invoice-1", bookingReference: "BR-1" }) });
    PaymentAllocation.findOne = () => ({ lean: async () => null });
    JournalEntry.findOne = invoiceJournalOnly;
    JournalEntryLine.find = () => ({ lean: async () => [{ _id: "line-1" }, { _id: "line-2" }] });

    const result = await service.postPayment({
      payment: {
        _id: "payment-1",
        bookingReference: "BR-1",
        intentId: "intent-1",
        status: "paid",
        verificationStatus: "verified",
        accountingAmount: 100
      }
    });

    assert.equal(result.action, "blocked");
    assert.equal(result.eligibility.status, service.STATES.POSTING_BLOCKED);
    assert.deepEqual(result.eligibility.blockers, ["PAYMENT_ALLOCATION_REQUIRED", "MISSING_PAYMENT_CURRENCY"]);
  } finally {
    Invoice.findOne = originals.invoiceFindOne;
    PaymentAllocation.findOne = originals.allocationFindOne;
    JournalEntry.findOne = originals.journalFindOne;
    JournalEntryLine.find = originals.lineFind;
  }
});

test("verified customer payment with changed amount or currency is blocked", async () => {
  const originals = {
    invoiceFindOne: Invoice.findOne,
    allocationFindOne: PaymentAllocation.findOne,
    journalFindOne: JournalEntry.findOne,
    lineFind: JournalEntryLine.find
  };
  try {
    Invoice.findOne = () => ({ lean: async () => ({ _id: "invoice-1", bookingReference: "BR-1" }) });
    PaymentAllocation.findOne = () => ({ lean: async () => ({ _id: "allocation-1", paymentId: "payment-1", bookingReference: "BR-1", status: "applied", amount: "100", currency: "USD" }) });
    JournalEntry.findOne = invoiceJournalOnly;
    JournalEntryLine.find = () => ({ lean: async () => [{ _id: "line-1" }, { _id: "line-2" }] });

    const result = await service.postPayment({
      payment: {
        _id: "payment-1",
        bookingReference: "BR-1",
        intentId: "intent-1",
        status: "paid",
        verificationStatus: "verified",
        accountingAmount: 125,
        accountingCurrency: "USD"
      }
    });

    assert.equal(result.action, "blocked");
    assert.deepEqual(result.eligibility.blockers, ["PAYMENT_ALLOCATION_MISMATCH", "PAYMENT_INVOICE_ASSOCIATION_REQUIRED"]);
  } finally {
    Invoice.findOne = originals.invoiceFindOne;
    PaymentAllocation.findOne = originals.allocationFindOne;
    JournalEntry.findOne = originals.journalFindOne;
    JournalEntryLine.find = originals.lineFind;
  }
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