const Booking = require("../../models/Booking");
const Invoice = require("../../models/Invoice");
const Payment = require("../../models/Payment");
const Refund = require("../../models/Refund");
const Settlement = require("../../models/Settlement");
const SettlementAllocation = require("../../models/SettlementAllocation");
const BusinessExpense = require("../../models/BusinessExpense");
const AccountingPosting = require("../../models/AccountingPosting");
const JournalEntry = require("../../models/JournalEntry");
const { resolveGuestPaymentPolicy } = require("../bookingPayment/policy");
const { normalizeCurrency, toDecimal } = require("../../utils/money");

const COMPLETED_REFUNDS = new Set(["refunded", "partially_refunded"]);
const COUNTED_EXPENSE_STATUSES = new Set(["SUBMITTED", "APPROVED", "PAID"]);
const OTA_CHANNELS = new Set(["GETYOURGUIDE", "VIATOR", "BOKUN_MARKETPLACE", "TOURHQ", "AIRBNB"]);

const asArray = (value) => (Array.isArray(value) ? value : []);
const token = (value) => String(value || "").trim();
const upper = (value) => token(value).toUpperCase();
const money = (value) => toDecimal(value || 0).toFixed();
const currency = (...values) => values.map(normalizeCurrency).find(Boolean) || "";

const lean = async (value) => {
  if (value && typeof value.lean === "function") return value.lean();
  return value;
};

const findOne = async (Model, query) => {
  if (!Model?.findOne) return null;
  return lean(Model.findOne(query));
};

const findMany = async (Model, query) => {
  if (!Model?.find) return [];
  return asArray(await lean(Model.find(query)));
};

const queryRows = async (Model, query, { limit = 500 } = {}) => {
  if (!Model?.find) return [];
  let result = Model.find(query);
  if (result?.sort) result = result.sort({ createdAt: -1, _id: -1 });
  if (result?.limit) result = result.limit(limit);
  return asArray(await lean(result));
};

const id = (row) => token(row?._id || row?.id);
const uniqueIds = (rows = []) => [...new Set(rows.map(id).filter(Boolean))];

const paymentIdentity = (payment) =>
  token(payment?.intentId || payment?.providerTransactionId || payment?.orderTrackingId || id(payment));

const isCountablePayment = (payment = {}) => {
  if (upper(payment.status) !== "PAID") return false;
  if (payment.accountingAmount === null || payment.accountingAmount === undefined) {
    return upper(payment.verificationStatus) === "VERIFIED" || Number(payment.amountPaid || payment.paidAmount || 0) > 0;
  }
  return upper(payment.verificationStatus) === "VERIFIED" && upper(payment.accountingAllocationStatus) === "APPLIED";
};

const uniquePayments = (payments) => {
  const rows = new Map();
  asArray(payments).filter(isCountablePayment).forEach((payment) => {
    const key = paymentIdentity(payment);
    if (!key) return;
    const current = rows.get(key);
    const amount = toDecimal(payment.accountingAmount ?? payment.amountPaid ?? payment.paidAmount ?? payment.amount ?? 0);
    if (!current || amount.greaterThan(toDecimal(current.accountingAmount ?? current.amountPaid ?? current.paidAmount ?? current.amount ?? 0))) {
      rows.set(key, payment);
    }
  });
  return [...rows.values()];
};

const refundAmount = (refund) =>
  refund.confirmedAccountingRefundedAmount ?? refund.confirmedRefundedAmount ?? refund.confirmedProviderRefundedAmount ?? 0;

const buildFinancialFacts = ({
  booking,
  invoice = null,
  payments = [],
  refunds = [],
  settlements = [],
  expenses = [],
  postings = [],
  journals = []
} = {}) => {
  const bookingCurrency = currency(booking?.transactionCurrency, booking?.bookingPaymentCurrency, booking?.currency, booking?.pricingSnapshot?.currency);
  const channel = upper(booking?.salesChannel || booking?.sourceChannel);
  const isDirect = channel === "DIRECT_WEBSITE";
  const isOta = OTA_CHANNELS.has(channel);
  const verifiedPayments = uniquePayments(payments);
  const verifiedPaidAmount = verifiedPayments.reduce(
    (total, payment) => total.plus(toDecimal(payment.accountingAmount ?? payment.amountPaid ?? payment.paidAmount ?? payment.amount ?? 0)),
    toDecimal(0)
  );
  const grossBookingRevenue = toDecimal(booking?.pricingSnapshot?.finalPayable ?? booking?.amount ?? invoice?.totalAmount ?? invoice?.total ?? 0);
  const guestPayment = resolveGuestPaymentPolicy({
    booking,
    total: grossBookingRevenue,
    verifiedPaidAmount
  });
  const completedRefunds = asArray(refunds).filter((refund) => COMPLETED_REFUNDS.has(String(refund.status || "").toLowerCase()));
  const refundsTotal = completedRefunds.reduce((total, refund) => total.plus(toDecimal(refundAmount(refund) || 0)), toDecimal(0));
  const applicableExpenses = asArray(expenses).filter((expense) => COUNTED_EXPENSE_STATUSES.has(upper(expense.status)));
  const directCosts = applicableExpenses.reduce((total, expense) => total.plus(toDecimal(expense.baseCurrencyAmount ?? expense.amount ?? 0)), toDecimal(0));
  const settlementRows = asArray(settlements).filter((row) => row.settlement && row.allocation);
  const uniqueSettlementRows = [...new Map(settlementRows.map((row) => [id(row.settlement), row])).values()];
  const payoutByCurrency = new Map();
  settlementRows.forEach(({ allocation }) => {
    const code = currency(allocation.currency);
    if (!code) return;
    payoutByCurrency.set(code, (payoutByCurrency.get(code) || toDecimal(0)).plus(toDecimal(allocation.amount || 0)));
  });
  const payoutCurrencies = [...payoutByCurrency.keys()];
  const settlementCommission = uniqueSettlementRows.reduce((total, row) => total.plus(toDecimal(row.settlement.commission?.amount || 0)), toDecimal(0));
  const settlementFees = uniqueSettlementRows.reduce((total, row) => total.plus(toDecimal(row.settlement.fees?.amount || 0)), toDecimal(0));
  const expectedPayout = uniqueSettlementRows.reduce((total, row) => total.plus(toDecimal(row.settlement.expectedNet?.amount || 0)), toDecimal(0));
  const allocatedPayout = settlementRows.reduce((total, row) => total.plus(toDecimal(row.allocation.amount || 0)), toDecimal(0));
  const payout = payoutCurrencies.length === 1 ? {
    status: "EVIDENCE_AVAILABLE",
    amount: payoutByCurrency.get(payoutCurrencies[0]).toFixed(),
    currency: payoutCurrencies[0],
    evidenceCount: uniqueSettlementRows.length
  } : {
    status: "AWAITING_EVIDENCE",
    amount: null,
    currency: payoutCurrencies.length ? null : bookingCurrency,
    evidenceCount: 0
  };
  const providerFees = verifiedPayments.reduce((total, payment) => total.plus(toDecimal(payment.providerFeeAmount || 0)), toDecimal(0));
  const invoiceTotal = invoice ? toDecimal(invoice.totalAmount ?? invoice.total ?? 0) : grossBookingRevenue;

  return {
    booking: { id: id(booking), reference: token(booking?.bookingReference), channel, currency: bookingCurrency },
    revenue: {
      grossBookingRevenue: money(grossBookingRevenue),
      invoicedRevenue: money(invoiceTotal),
      directBookingRevenue: isDirect ? money(grossBookingRevenue) : null,
      otaGrossSales: isOta ? money(grossBookingRevenue) : null,
      classification: isDirect ? "DIRECT" : isOta ? "OTA" : "UNKNOWN"
    },
    guestPayment: {
      amount: money(guestPayment.amountPaid),
      currency: bookingCurrency,
      collector: guestPayment.collector || "",
      source: guestPayment.source,
      evidenceCount: verifiedPayments.length
    },
    receivable: {
      amount: money(guestPayment.amountPaid ? grossBookingRevenue.minus(guestPayment.amountPaid) : grossBookingRevenue),
      currency: bookingCurrency,
      otaPendingPayout: isOta && expectedPayout.gt(0) ? money(expectedPayout.minus(allocatedPayout).lt(0) ? 0 : expectedPayout.minus(allocatedPayout)) : isOta ? null : "0",
      otaPendingPayoutStatus: isOta ? (expectedPayout.gt(0) ? "EVIDENCE_AVAILABLE" : "AWAITING_EVIDENCE") : "NOT_APPLICABLE"
    },
    refunds: { amount: money(refundsTotal), currency: bookingCurrency, evidenceCount: completedRefunds.length },
    settlement: payout,
    expenses: {
      directCosts: money(directCosts),
      operatingExpenses: "0",
      currency: currency(...applicableExpenses.map((expense) => expense.baseCurrency || expense.currency), bookingCurrency),
      evidenceCount: applicableExpenses.length,
      references: applicableExpenses.map((expense) => token(expense.expenseReference)).filter(Boolean)
    },
    fees: {
      paymentGatewayFees: money(providerFees),
      otaCommissions: uniqueSettlementRows.length ? money(settlementCommission) : null,
      settlementFees: uniqueSettlementRows.length ? money(settlementFees) : null,
      currency: bookingCurrency,
      status: uniqueSettlementRows.length ? "EVIDENCE_AVAILABLE" : "AWAITING_EVIDENCE"
    },
    accounting: {
      postingCount: asArray(postings).length,
      journalCount: asArray(journals).length,
      status: postings.length || journals.length ? "LINKED" : "MISSING",
      postingIds: postings.map(id).filter(Boolean),
      journalIds: journals.map(id).filter(Boolean)
    },
    trace: {
      bookingId: id(booking),
      invoiceId: id(invoice),
      paymentIds: uniqueIds(verifiedPayments),
      refundIds: uniqueIds(completedRefunds),
      settlementIds: uniqueIds(settlementRows.map((row) => row.settlement)),
      expenseIds: uniqueIds(applicableExpenses),
      accountingPostingIds: uniqueIds(postings),
      journalEntryIds: uniqueIds(journals)
    },
    evidence: {
      invoice: Boolean(invoice),
      guestPayment: guestPayment.source === "OTA_CHANNEL" || verifiedPayments.length > 0,
      settlement: uniqueSettlementRows.length > 0,
      expenses: applicableExpenses.length > 0,
      accounting: postings.length > 0 || journals.length > 0
    }
  };
};

const createFinancialReportingService = ({
  BookingModel = Booking,
  InvoiceModel = Invoice,
  PaymentModel = Payment,
  RefundModel = Refund,
  SettlementModel = Settlement,
  SettlementAllocationModel = SettlementAllocation,
  BusinessExpenseModel = BusinessExpense,
  AccountingPostingModel = AccountingPosting,
  JournalEntryModel = JournalEntry
} = {}) => {
  const loadBookingFinancialFacts = async (bookingReference) => {
    const reference = token(bookingReference);
    const booking = await findOne(BookingModel, { bookingReference: reference });
    if (!booking) return null;
    const [invoice, payments, refunds, expenses, postings, journals, allocations] = await Promise.all([
      findOne(InvoiceModel, { bookingReference: reference }),
      findMany(PaymentModel, { bookingReference: reference }),
      findMany(RefundModel, { bookingId: booking._id }),
      findMany(BusinessExpenseModel, { bookingReference: reference }),
      findMany(AccountingPostingModel, { bookingReference: reference }),
      findMany(JournalEntryModel, { $or: [{ "source.sourceReference": reference }, { "sourceSnapshot.booking.bookingReference": reference }] }),
      findMany(SettlementAllocationModel, { bookingReference: reference, status: "APPLIED" })
    ]);
    const settlementIds = [...new Set(allocations.map((allocation) => String(allocation.settlementId)).filter(Boolean))];
    const settlementRows = settlementIds.length
      ? await findMany(SettlementModel, { _id: { $in: settlementIds } })
      : [];
    const settlementById = new Map(settlementRows.map((settlement) => [String(settlement._id), settlement]));
    const settlements = allocations.map((allocation) => ({ allocation, settlement: settlementById.get(String(allocation.settlementId)) })).filter((row) => row.settlement);
    return buildFinancialFacts({ booking, invoice, payments, refunds, settlements, expenses, postings, journals });
  };

  const getAuthoritativeSummary = async ({ fromDate = "", toDate = "", limit = 500 } = {}) => {
    const dateQuery = {};
    const parseDate = (value, endOfDay = false) => {
      if (!value) return null;
      const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;
      if (endOfDay && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        parsed.setUTCHours(23, 59, 59, 999);
      }
      return parsed;
    };
    const parsedFromDate = parseDate(fromDate);
    const parsedToDate = parseDate(toDate, true);
    if (parsedFromDate || parsedToDate) {
      dateQuery.createdAt = {};
      if (parsedFromDate) dateQuery.createdAt.$gte = parsedFromDate;
      if (parsedToDate) dateQuery.createdAt.$lte = parsedToDate;
    }
    const bookings = await queryRows(BookingModel, dateQuery, { limit: Math.max(1, Math.min(5000, Number(limit || 500))) });
    const facts = (await Promise.all(bookings.map((booking) => loadBookingFinancialFacts(booking.bookingReference)))).filter(Boolean);
    const byCurrency = new Map();
    const add = (row, key, value) => {
      if (value === null || value === undefined) return;
      row[key] = row[key].plus(toDecimal(value));
    };
    facts.forEach((fact) => {
      const code = fact.booking.currency || "UNKNOWN";
      const row = byCurrency.get(code) || {
        currency: code,
        bookings: 0,
        grossBookingRevenue: toDecimal(0),
        directBookingRevenue: toDecimal(0),
        otaGrossSales: toDecimal(0),
        guestPaymentsCollected: toDecimal(0),
        guestReceivables: toDecimal(0),
        otaReceivables: toDecimal(0),
        otaPayoutsReceived: toDecimal(0),
        otaCommissions: toDecimal(0),
        paymentGatewayFees: toDecimal(0),
        refunds: toDecimal(0),
        directCosts: toDecimal(0),
        unknownOtaPayouts: 0,
        unknownCommissions: 0
      };
      row.bookings += 1;
      add(row, "grossBookingRevenue", fact.revenue.grossBookingRevenue);
      add(row, "directBookingRevenue", fact.revenue.directBookingRevenue);
      add(row, "otaGrossSales", fact.revenue.otaGrossSales);
      add(row, "guestPaymentsCollected", fact.guestPayment.amount);
      add(row, "guestReceivables", fact.booking.channel === "DIRECT_WEBSITE" ? fact.receivable.amount : "0");
      if (fact.receivable.otaPendingPayout !== null) add(row, "otaReceivables", fact.receivable.otaPendingPayout);
      else if (fact.revenue.classification === "OTA") row.unknownOtaPayouts += 1;
      if (fact.settlement.amount !== null) add(row, "otaPayoutsReceived", fact.settlement.amount);
      if (fact.fees.otaCommissions !== null) add(row, "otaCommissions", fact.fees.otaCommissions);
      else if (fact.revenue.classification === "OTA") row.unknownCommissions += 1;
      add(row, "paymentGatewayFees", fact.fees.paymentGatewayFees);
      add(row, "refunds", fact.refunds.amount);
      add(row, "directCosts", fact.expenses.directCosts);
      byCurrency.set(code, row);
    });
    const items = [...byCurrency.values()].map((row) => {
      const netRevenue = row.unknownCommissions
        ? null
        : row.grossBookingRevenue.minus(row.refunds).minus(row.otaCommissions).minus(row.paymentGatewayFees);
      const grossProfit = netRevenue === null ? null : netRevenue.minus(row.directCosts);
      return {
        currency: row.currency,
        bookings: row.bookings,
        grossBookingRevenue: row.grossBookingRevenue.toFixed(),
        directBookingRevenue: row.directBookingRevenue.toFixed(),
        otaGrossSales: row.otaGrossSales.toFixed(),
        guestPaymentsCollected: row.guestPaymentsCollected.toFixed(),
        guestReceivables: row.guestReceivables.toFixed(),
        otaReceivables: row.unknownOtaPayouts ? null : row.otaReceivables.toFixed(),
        otaPayoutsReceived: row.otaPayoutsReceived.toFixed(),
        otaCommissions: row.unknownCommissions ? null : row.otaCommissions.toFixed(),
        paymentGatewayFees: row.paymentGatewayFees.toFixed(),
        refunds: row.refunds.toFixed(),
        directCosts: row.directCosts.toFixed(),
        operatingExpenses: null,
        netRevenue: netRevenue === null ? null : netRevenue.toFixed(),
        grossProfit: grossProfit === null ? null : grossProfit.toFixed(),
        netProfit: null,
        evidence: {
          unknownOtaPayoutBookings: row.unknownOtaPayouts,
          unknownCommissionBookings: row.unknownCommissions,
          operatingExpenses: "AWAITING_BUSINESS_EXPENSE_ALLOCATION"
        }
      };
    });
    return {
      readOnly: true,
      scannedBookings: facts.length,
      currencies: items.map((item) => item.currency),
      mixedCurrencies: items.length > 1,
      items,
      limitations: [
        "Amounts are grouped by currency and are never combined across currencies.",
        "OTA payout and commission values remain null when settlement evidence is unavailable.",
        "Net profit remains null until operating expenses are allocated from approved BusinessExpense records."
      ]
    };
  };

  return { getAuthoritativeSummary, loadBookingFinancialFacts };
};

const service = createFinancialReportingService();

module.exports = { ...service, buildFinancialFacts, createFinancialReportingService };