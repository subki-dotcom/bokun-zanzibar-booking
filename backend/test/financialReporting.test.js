const test = require("node:test");
const assert = require("node:assert/strict");
const { buildFinancialFacts, createFinancialReportingService } = require("../src/services/financialReporting");

const booking = (overrides = {}) => ({
  _id: "booking-1",
  bookingReference: "BK-100",
  bookingStatus: "confirmed",
  salesChannel: "DIRECT_WEBSITE",
  currency: "USD",
  pricingSnapshot: { finalPayable: 100 },
  ...overrides
});

test("derives direct payment, refund, expense and trace facts from authoritative records", () => {
  const facts = buildFinancialFacts({
    booking: booking(),
    invoice: { _id: "invoice-1", totalAmount: 100 },
    payments: [{
      _id: "payment-1",
      intentId: "intent-1",
      status: "paid",
      verificationStatus: "verified",
      accountingAllocationStatus: "applied",
      accountingAmount: 100,
      accountingCurrency: "USD",
      providerFeeAmount: 3
    }],
    refunds: [{ _id: "refund-1", status: "refunded", confirmedAccountingRefundedAmount: 20 }],
    expenses: [{ _id: "expense-1", expenseReference: "EXP-1", status: "APPROVED", amount: 25, currency: "USD" }],
    postings: [{ _id: "posting-1" }],
    journals: [{ _id: "journal-1" }]
  });

  assert.equal(facts.revenue.grossBookingRevenue, "100");
  assert.equal(facts.guestPayment.amount, "100");
  assert.equal(facts.refunds.amount, "20");
  assert.equal(facts.expenses.directCosts, "25");
  assert.equal(facts.fees.paymentGatewayFees, "3");
  assert.deepEqual(facts.trace.paymentIds, ["payment-1"]);
  assert.deepEqual(facts.trace.refundIds, ["refund-1"]);
  assert.equal(facts.accounting.status, "LINKED");
});

test("uses the channel policy for OTA guest collection and does not invent payout evidence", () => {
  const facts = buildFinancialFacts({
    booking: booking({ salesChannel: "GETYOURGUIDE" }),
    invoice: { _id: "invoice-1", totalAmount: 100 },
    payments: []
  });

  assert.equal(facts.guestPayment.amount, "100");
  assert.equal(facts.guestPayment.source, "OTA_CHANNEL");
  assert.equal(facts.settlement.status, "AWAITING_EVIDENCE");
  assert.equal(facts.settlement.amount, null);
  assert.equal(facts.fees.otaCommissions, null);
});

test("keeps OTA payout receivable separate and does not duplicate settlement fees per allocation", () => {
  const settlement = {
    _id: "settlement-1",
    expectedNet: { amount: 80, currency: "USD" },
    commission: { amount: 15, currency: "USD" },
    fees: { amount: 5, currency: "USD" }
  };
  const facts = buildFinancialFacts({
    booking: booking({ salesChannel: "VIATOR" }),
    settlements: [
      { settlement, allocation: { _id: "allocation-1", amount: 40, currency: "USD" } },
      { settlement, allocation: { _id: "allocation-2", amount: 40, currency: "USD" } }
    ]
  });

  assert.equal(facts.receivable.amount, "0");
  assert.equal(facts.receivable.otaPendingPayout, "0");
  assert.equal(facts.fees.otaCommissions, "15");
  assert.equal(facts.fees.settlementFees, "5");
  assert.deepEqual(facts.trace.settlementIds, ["settlement-1"]);
});

test("does not classify an unknown channel as direct or OTA revenue", () => {
  const facts = buildFinancialFacts({
    booking: booking({ salesChannel: "" }),
    invoice: { _id: "invoice-1", totalAmount: 100 }
  });

  assert.equal(facts.revenue.classification, "UNKNOWN");
  assert.equal(facts.revenue.directBookingRevenue, null);
  assert.equal(facts.revenue.otaGrossSales, null);
  assert.equal(facts.receivable.otaPendingPayoutStatus, "NOT_APPLICABLE");
});

test("loads all booking-linked authoritative records without writing", async () => {
  const calls = [];
  const model = (rows) => ({
    findOne: async (query) => { calls.push(["findOne", query]); return rows[0] || null; },
    find: async (query) => { calls.push(["find", query]); return rows; }
  });
  const service = createFinancialReportingService({
    BookingModel: model([booking()]),
    InvoiceModel: model([{ _id: "invoice-1", totalAmount: 100 }]),
    PaymentModel: model([]),
    RefundModel: model([]),
    BusinessExpenseModel: model([]),
    AccountingPostingModel: model([]),
    JournalEntryModel: model([]),
    SettlementAllocationModel: model([]),
    SettlementModel: model([])
  });

  const facts = await service.loadBookingFinancialFacts("BK-100");

  assert.equal(facts.booking.reference, "BK-100");
  assert.equal(calls.some(([method]) => method === "create" || method === "updateOne"), false);
});

test("builds a currency-safe authoritative portfolio summary without estimating unknown OTA values", async () => {
  const bookings = [
    booking({ _id: "booking-direct", bookingReference: "BK-DIRECT", salesChannel: "DIRECT_WEBSITE", currency: "USD" }),
    booking({ _id: "booking-ota", bookingReference: "BK-OTA", salesChannel: "GETYOURGUIDE", currency: "EUR" })
  ];
  const model = (rows) => ({
    findOne: async (query) => rows.find((row) =>
      query.bookingReference ? row.bookingReference === query.bookingReference : String(row._id) === String(query._id)
    ) || null,
    find: async () => rows
  });
  const service = createFinancialReportingService({
    BookingModel: model(bookings),
    InvoiceModel: model([]),
    PaymentModel: model([]),
    RefundModel: model([]),
    BusinessExpenseModel: model([]),
    AccountingPostingModel: model([]),
    JournalEntryModel: model([]),
    SettlementAllocationModel: model([]),
    SettlementModel: model([])
  });

  const summary = await service.getAuthoritativeSummary({ limit: 10 });

  assert.equal(summary.readOnly, true);
  assert.equal(summary.scannedBookings, 2);
  assert.equal(summary.mixedCurrencies, true);
  assert.deepEqual(summary.items.map((row) => row.currency).sort(), ["EUR", "USD"]);
  assert.equal(summary.items.find((row) => row.currency === "EUR").otaReceivables, null);
  assert.equal(summary.items.find((row) => row.currency === "EUR").otaCommissions, null);
  assert.equal(summary.items.find((row) => row.currency === "EUR").netRevenue, null);
  assert.equal(summary.items.find((row) => row.currency === "EUR").grossProfit, null);
  assert.equal(summary.items.find((row) => row.currency === "USD").netProfit, null);
});

test("does not classify unknown channels as OTA evidence gaps in the portfolio summary", async () => {
  const unknownBooking = booking({
    _id: "booking-unknown",
    bookingReference: "BK-UNKNOWN",
    salesChannel: "PARTNER_PORTAL",
    currency: "USD"
  });
  const model = (rows) => ({
    findOne: async (query) => rows.find((row) => query.bookingReference ? row.bookingReference === query.bookingReference : String(row._id) === String(query._id)) || null,
    find: async () => rows
  });
  const service = createFinancialReportingService({
    BookingModel: model([unknownBooking]),
    InvoiceModel: model([]),
    PaymentModel: model([]),
    RefundModel: model([]),
    BusinessExpenseModel: model([]),
    AccountingPostingModel: model([]),
    JournalEntryModel: model([]),
    SettlementAllocationModel: model([]),
    SettlementModel: model([])
  });

  const summary = await service.getAuthoritativeSummary({ limit: 1 });

  assert.equal(summary.items[0].evidence.unknownOtaPayoutBookings, 0);
  assert.equal(summary.items[0].evidence.unknownCommissionBookings, 0);
  assert.equal(summary.items[0].otaReceivables, "0");
  assert.equal(summary.items[0].otaCommissions, "0");
});