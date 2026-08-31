const Booking = require("../../models/Booking");
const BusinessExpense = require("../../models/BusinessExpense");
const Invoice = require("../../models/Invoice");
const Payment = require("../../models/Payment");
const Refund = require("../../models/Refund");
const { EXPENSE_CATEGORY } = require("../../accounting/constants");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const asArray = (value) => (Array.isArray(value) ? value : []);

const normalizeToken = (value = "") => String(value || "").trim();
const normalizeLower = (value = "") => normalizeToken(value).toLowerCase();
const normalizeUpper = (value = "") => normalizeToken(value).toUpperCase();

const getId = (record = {}) => normalizeToken(record?._id || record?.id);

const escapeRegex = (value = "") => normalizeToken(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "$numberDecimal")) {
    const parsed = Number(value.$numberDecimal);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (typeof value === "object" && value._bsontype === "Decimal128" && typeof value.toString === "function") {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundMoney = (value) => Number(toNumber(value, 0).toFixed(2));

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toIso = (value) => {
  const date = toDate(value);
  return date ? date.toISOString() : "";
};

const pagination = ({ page = 1, limit = DEFAULT_LIMIT } = {}) => {
  const safePage = Math.max(1, Number(page || 1));
  const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Number(limit || DEFAULT_LIMIT)));
  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit
  };
};

const addDateRange = (query, field, { fromDate = "", toDate: endDate = "" } = {}) => {
  const range = {};
  const from = toDate(fromDate);
  const to = toDate(endDate);
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  if (Object.keys(range).length) query[field] = range;
  return query;
};

const addRegexSearch = (query, fields = [], search = "") => {
  const pattern = escapeRegex(search);
  if (!pattern) return query;
  const searchClause = {
    $or: fields.map((field) => ({ [field]: new RegExp(pattern, "i") }))
  };
  if (query.$or) {
    const existingOr = query.$or;
    delete query.$or;
    query.$and = [...(query.$and || []), { $or: existingOr }, searchClause];
    return query;
  }
  query.$or = searchClause.$or;
  return query;
};

const applyQueryChain = async (query, { sort = { updatedAt: -1 }, skip = 0, limit = DEFAULT_LIMIT } = {}) => {
  if (Array.isArray(query)) return query.slice(skip, skip + limit);
  let chain = query;
  if (chain?.sort) chain = chain.sort(sort);
  if (chain?.skip) chain = chain.skip(skip);
  if (chain?.limit) chain = chain.limit(limit);
  if (chain?.lean) chain = chain.lean();
  const rows = await chain;
  return asArray(rows);
};

const findRows = async (Model, query = {}, options = {}) => {
  if (!Model?.find) return [];
  const found = Model.find(query);
  return applyQueryChain(found, options);
};

const countRows = async (Model, query = {}) => {
  if (Model?.countDocuments) return Number(await Model.countDocuments(query));
  return (await findRows(Model, query, { limit: MAX_LIMIT })).length;
};

const buildMap = (records = [], keyFn) =>
  records.reduce((map, record) => {
    const key = normalizeToken(keyFn(record));
    if (!key) return map;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(record);
    return map;
  }, new Map());

const latestByDate = (records = []) =>
  [...records].sort((left, right) => {
    const rightDate = toDate(right?.updatedAt || right?.createdAt || right?.paidAt)?.getTime() || 0;
    const leftDate = toDate(left?.updatedAt || left?.createdAt || left?.paidAt)?.getTime() || 0;
    return rightDate - leftDate;
  })[0] || null;

const isPaidPayment = (payment = {}) =>
  normalizeLower(payment.status) === "paid" ||
  normalizeLower(payment.paymentStatus) === "paid" ||
  normalizeLower(payment.verificationStatus) === "verified" ||
  toNumber(payment.amountPaid || payment.paidAmount) > 0;

const isCompletedRefund = (refund = {}) =>
  ["refunded", "partially_refunded"].includes(normalizeLower(refund.status));

const getPaymentPaidAmount = (payment = {}) =>
  roundMoney(payment.amountPaid ?? payment.paidAmount ?? payment.accountingAmount ?? payment.chargedAmount ?? payment.amount);

const getRefundConfirmedAmount = (refund = {}) =>
  roundMoney(
    refund.confirmedRefundedAmount ??
      refund.confirmedAccountingRefundedAmount ??
      refund.confirmedProviderRefundedAmount ??
      0
  );

const getInvoiceTotal = (invoice = {}) => roundMoney(invoice.totalAmount ?? invoice.total ?? 0);
const getInvoicePaid = (invoice = {}) => roundMoney(invoice.paidAccountingAmount ?? invoice.amountPaid ?? 0);
const getInvoiceRefunded = (invoice = {}) => roundMoney(invoice.refundedAccountingAmount ?? invoice.amountRefunded ?? 0);

const getPrimaryCurrency = (...records) => {
  for (const record of records) {
    const currency = normalizeUpper(
      record?.accountingCurrency ||
        record?.currency ||
        record?.baseCurrency ||
        record?.chargedCurrency ||
        record?.orderCurrency ||
        record?.requestedRefundCurrency
    );
    if (currency) return currency;
  }
  return "USD";
};

const normalizeInvoice = (invoice = {}) => {
  const currency = getPrimaryCurrency(invoice);
  const total = getInvoiceTotal(invoice);
  const amountPaid = getInvoicePaid(invoice);
  const amountRefunded = getInvoiceRefunded(invoice);
  const netAmountPaid = roundMoney(invoice.netAccountingAmount ?? invoice.netAmountPaid ?? amountPaid - amountRefunded);
  const balanceDue = roundMoney(invoice.balanceDueAmount ?? invoice.balanceDue ?? total - amountPaid + amountRefunded);

  return {
    id: getId(invoice),
    invoiceNumber: invoice.invoiceNumber || "",
    bookingReference: invoice.bookingReference || "",
    clientName: invoice.clientName || "",
    clientEmail: invoice.clientEmail || "",
    tourName: invoice.tourName || "",
    bookedOption: invoice.bookedOption || "",
    paymentStatus: invoice.paymentStatus || "unknown",
    bookingStatus: invoice.bookingStatus || "unknown",
    total,
    amountPaid,
    amountRefunded,
    netAmountPaid,
    balanceDue,
    currency,
    issueDate: toIso(invoice.issueDate || invoice.createdAt),
    updatedAt: toIso(invoice.updatedAt)
  };
};

const normalizeRefund = (refund = {}, { bookingsById = new Map(), paymentsById = new Map(), invoicesById = new Map() } = {}) => {
  const booking = bookingsById.get(normalizeToken(refund.bookingId))?.[0] || null;
  const payment = paymentsById.get(normalizeToken(refund.paymentId))?.[0] || null;
  const invoice = invoicesById.get(normalizeToken(refund.invoiceId))?.[0] || null;
  const requestedAmount = roundMoney(refund.requestedAmount ?? refund.requestedRefundAmount ?? refund.amount ?? 0);
  const confirmedRefundedAmount = getRefundConfirmedAmount(refund);
  const currency = getPrimaryCurrency(refund, payment, invoice, booking);

  return {
    id: getId(refund),
    refundReference: refund.refundReference || "",
    bookingReference: booking?.bookingReference || invoice?.bookingReference || payment?.bookingReference || "",
    paymentId: normalizeToken(refund.paymentId),
    invoiceId: normalizeToken(refund.invoiceId),
    status: refund.status || "unknown",
    providerRefundStatus: refund.providerRefundStatus || "",
    provider: refund.provider || payment?.provider || "",
    requestedAmount,
    confirmedRefundedAmount,
    eligibleRefundAmount: refund.eligibleRefundAmount === null ? null : roundMoney(refund.eligibleRefundAmount),
    cancellationFee: refund.cancellationFee === null ? null : roundMoney(refund.cancellationFee),
    currency,
    providerRefundRequestReference: refund.providerRefundRequestReference || "",
    providerRefundReference: refund.providerRefundReference || "",
    originalTransactionReference: refund.originalTransactionReference || "",
    originalProviderTransactionId: refund.originalProviderTransactionId || "",
    requestedAt: toIso(refund.requestedAt || refund.createdAt),
    approvedAt: toIso(refund.approvedAt),
    processingStartedAt: toIso(refund.processingStartedAt),
    completedAt: toIso(refund.completedAt),
    lastRefundSyncAt: toIso(refund.lastRefundSyncAt),
    failureReason: refund.failureReason || ""
  };
};

const normalizeExpense = (expense = {}) => ({
  id: getId(expense),
  expenseReference: expense.expenseReference || "",
  bookingReference: expense.bookingReference || "",
  category: expense.category || "",
  description: expense.description || "",
  supplierName: expense.supplier?.name || expense.supplier?.supplierId || "",
  amount: roundMoney(expense.amount),
  currency: normalizeUpper(expense.currency || "USD"),
  baseCurrencyAmount: roundMoney(expense.baseCurrencyAmount ?? expense.amount),
  baseCurrency: normalizeUpper(expense.baseCurrency || expense.currency || "USD"),
  paymentStatus: expense.paymentStatus || "",
  status: expense.status || "",
  sourceModule: expense.sourceModule || "",
  sourceReference: expense.sourceReference || "",
  expenseDate: toIso(expense.expenseDate || expense.createdAt),
  dueDate: toIso(expense.dueDate),
  updatedAt: toIso(expense.updatedAt)
});

const bookingLinkedExpenseQuery = (query = {}) => ({
  ...query,
  $or: [
    { bookingReference: { $exists: true, $ne: "" } },
    { bookingId: { $exists: true, $ne: null } },
    { sourceModule: "BOOKING_ACCOUNTING" },
    { sourceModule: "BOOKING" }
  ]
});

const invoiceBalanceMismatch = (invoice = {}) => {
  const total = getInvoiceTotal(invoice);
  const paid = getInvoicePaid(invoice);
  const refunded = getInvoiceRefunded(invoice);
  const balance = roundMoney(invoice.balanceDueAmount ?? invoice.balanceDue ?? total - paid + refunded);
  return Math.abs(roundMoney(total - paid + refunded) - balance) > 0.01;
};

const buildReconciliationIssues = ({ bookings = [], invoices = [], payments = [], refunds = [], expenses = [] } = {}) => {
  const issues = [];
  const bookingsByReference = buildMap(bookings, (booking) => booking.bookingReference);
  const invoicesByReference = buildMap(invoices, (invoice) => invoice.bookingReference);
  const paymentsByReference = buildMap(payments, (payment) => payment.bookingReference);

  bookings.forEach((booking) => {
    const reference = booking.bookingReference || "";
    if ((booking.paymentStatus === "paid" || booking.bookingStatus === "confirmed") && !invoicesByReference.has(reference)) {
      issues.push({
        code: "MISSING_INVOICE",
        severity: "ERROR",
        entityType: "Booking",
        entityId: getId(booking),
        reference,
        message: "Confirmed or paid booking has no linked invoice."
      });
    }
    if (booking.paymentStatus === "paid" && !asArray(paymentsByReference.get(reference)).some(isPaidPayment)) {
      issues.push({
        code: "MISSING_PAYMENT_LINK",
        severity: "ERROR",
        entityType: "Booking",
        entityId: getId(booking),
        reference,
        message: "Booking is marked paid but no successful payment row is linked."
      });
    }
  });

  invoices.forEach((invoice) => {
    const reference = invoice.bookingReference || invoice.invoiceNumber || "";
    if (invoice.paymentStatus === "paid" && !asArray(paymentsByReference.get(invoice.bookingReference)).some(isPaidPayment)) {
      issues.push({
        code: "MISSING_PAYMENT_LINK",
        severity: "ERROR",
        entityType: "Invoice",
        entityId: getId(invoice),
        reference,
        message: "Invoice is marked paid but has no linked successful payment."
      });
    }
    if (invoiceBalanceMismatch(invoice)) {
      issues.push({
        code: "INVOICE_BALANCE_MISMATCH",
        severity: "ERROR",
        entityType: "Invoice",
        entityId: getId(invoice),
        reference,
        message: "Invoice total, paid, refunded and balance fields do not reconcile."
      });
    }
  });

  payments.forEach((payment) => {
    const reference = payment.bookingReference || payment.merchantReference || payment.intentId || "";
    if (payment.bookingReference && !bookingsByReference.has(payment.bookingReference)) {
      issues.push({
        code: "MISSING_BOOKING_LINK",
        severity: "ERROR",
        entityType: "Payment",
        entityId: getId(payment),
        reference,
        message: "Payment points to a booking reference that does not exist locally."
      });
    }
    if (payment.anomaly?.flagged || ["amount_mismatch", "currency_review_required", "reference_mismatch"].includes(payment.verificationStatus)) {
      issues.push({
        code: "PAYMENT_RECONCILIATION_REVIEW",
        severity: "WARNING",
        entityType: "Payment",
        entityId: getId(payment),
        reference,
        message: "Payment has provider/accounting reconciliation evidence that needs review."
      });
    }
  });

  refunds.forEach((refund) => {
    if (isCompletedRefund(refund) && getRefundConfirmedAmount(refund) <= 0) {
      issues.push({
        code: "REFUND_CONFIRMED_AMOUNT_ZERO",
        severity: "ERROR",
        entityType: "Refund",
        entityId: getId(refund),
        reference: refund.refundReference || "",
        message: "Refund is completed but confirmed refunded amount is zero."
      });
    }
  });

  expenses.forEach((expense) => {
    if (expense.bookingReference && !bookingsByReference.has(expense.bookingReference)) {
      issues.push({
        code: "EXPENSE_BOOKING_LINK_MISSING",
        severity: "WARNING",
        entityType: "BusinessExpense",
        entityId: getId(expense),
        reference: expense.bookingReference || expense.expenseReference || "",
        message: "Booking-linked expense points to a booking reference that does not exist locally."
      });
    }
  });

  return issues;
};

const createBookingAccountingService = ({
  BookingModel = Booking,
  BusinessExpenseModel = BusinessExpense,
  InvoiceModel = Invoice,
  PaymentModel = Payment,
  RefundModel = Refund
} = {}) => {
  const loadRefundRelations = async (refunds = []) => {
    const bookingIds = refunds.map((refund) => normalizeToken(refund.bookingId)).filter(Boolean);
    const paymentIds = refunds.map((refund) => normalizeToken(refund.paymentId)).filter(Boolean);
    const invoiceIds = refunds.map((refund) => normalizeToken(refund.invoiceId)).filter(Boolean);
    const [bookings, payments, invoices] = await Promise.all([
      bookingIds.length ? findRows(BookingModel, { _id: { $in: bookingIds } }, { limit: MAX_LIMIT }) : [],
      paymentIds.length ? findRows(PaymentModel, { _id: { $in: paymentIds } }, { limit: MAX_LIMIT }) : [],
      invoiceIds.length ? findRows(InvoiceModel, { _id: { $in: invoiceIds } }, { limit: MAX_LIMIT }) : []
    ]);
    return {
      bookingsById: buildMap(bookings, (booking) => getId(booking)),
      paymentsById: buildMap(payments, (payment) => getId(payment)),
      invoicesById: buildMap(invoices, (invoice) => getId(invoice))
    };
  };

  const listInvoices = async (filters = {}) => {
    const { page, limit, skip } = pagination(filters);
    const query = {};
    if (filters.status) query.paymentStatus = filters.status;
    addDateRange(query, "issueDate", filters);
    addRegexSearch(query, ["invoiceNumber", "bookingReference", "clientName", "clientEmail", "tourName"], filters.search);
    const [rows, total] = await Promise.all([
      findRows(InvoiceModel, query, { sort: { issueDate: -1, createdAt: -1 }, skip, limit }),
      countRows(InvoiceModel, query)
    ]);
    return {
      items: rows.map(normalizeInvoice),
      total,
      page,
      limit,
      count: rows.length
    };
  };

  const listRefunds = async (filters = {}) => {
    const { page, limit, skip } = pagination(filters);
    const query = {};
    if (filters.status) query.status = filters.status;
    if (filters.provider) query.provider = normalizeLower(filters.provider);
    addDateRange(query, "createdAt", filters);
    addRegexSearch(
      query,
      [
        "refundReference",
        "providerRefundRequestReference",
        "providerRefundReference",
        "originalTransactionReference",
        "originalProviderTransactionId"
      ],
      filters.search
    );
    const [rows, total] = await Promise.all([
      findRows(RefundModel, query, { sort: { updatedAt: -1, createdAt: -1 }, skip, limit }),
      countRows(RefundModel, query)
    ]);
    const relations = await loadRefundRelations(rows);
    return {
      items: rows.map((refund) => normalizeRefund(refund, relations)),
      total,
      page,
      limit,
      count: rows.length
    };
  };

  const listExpenses = async (filters = {}) => {
    const { page, limit, skip } = pagination(filters);
    let query = bookingLinkedExpenseQuery({});
    if (filters.status) query.status = filters.status;
    if (filters.category) query.category = filters.category;
    addDateRange(query, "expenseDate", filters);
    addRegexSearch(query, ["expenseReference", "bookingReference", "description", "supplier.name"], filters.search);
    const [rows, total] = await Promise.all([
      findRows(BusinessExpenseModel, query, { sort: { expenseDate: -1, createdAt: -1 }, skip, limit }),
      countRows(BusinessExpenseModel, query)
    ]);
    return {
      items: rows.map(normalizeExpense),
      total,
      page,
      limit,
      count: rows.length
    };
  };

  const loadSnapshot = async (filters = {}) => {
    const scanLimit = Math.max(50, Math.min(MAX_LIMIT, Number(filters.limit || 250)));
    const [bookings, invoices, payments, refunds, expenses] = await Promise.all([
      findRows(BookingModel, {}, { sort: { updatedAt: -1, createdAt: -1 }, limit: scanLimit }),
      findRows(InvoiceModel, {}, { sort: { updatedAt: -1, createdAt: -1 }, limit: scanLimit }),
      findRows(PaymentModel, {}, { sort: { updatedAt: -1, createdAt: -1 }, limit: scanLimit }),
      findRows(RefundModel, {}, { sort: { updatedAt: -1, createdAt: -1 }, limit: scanLimit }),
      findRows(BusinessExpenseModel, bookingLinkedExpenseQuery({}), { sort: { updatedAt: -1, createdAt: -1 }, limit: scanLimit })
    ]);
    return { bookings, invoices, payments, refunds, expenses, scanLimit };
  };

  const getProfitability = async (filters = {}) => {
    const { bookings, invoices, payments, refunds, expenses, scanLimit } = await loadSnapshot(filters);
    const bookingsByReference = buildMap(bookings, (booking) => booking.bookingReference);
    const invoicesByReference = buildMap(invoices, (invoice) => invoice.bookingReference);
    const paymentsByReference = buildMap(payments, (payment) => payment.bookingReference);
    const expensesByReference = buildMap(expenses, (expense) => expense.bookingReference);
    const refundsByPaymentId = buildMap(refunds.filter(isCompletedRefund), (refund) => normalizeToken(refund.paymentId));

    const references = Array.from(
      new Set([
        ...bookings.map((booking) => booking.bookingReference).filter(Boolean),
        ...invoices.map((invoice) => invoice.bookingReference).filter(Boolean),
        ...payments.map((payment) => payment.bookingReference).filter(Boolean),
        ...expenses.map((expense) => expense.bookingReference).filter(Boolean)
      ])
    );

    const items = references.map((bookingReference) => {
      const booking = latestByDate(bookingsByReference.get(bookingReference) || []);
      const invoice = latestByDate(invoicesByReference.get(bookingReference) || []);
      const bookingPayments = paymentsByReference.get(bookingReference) || [];
      const paidPayments = bookingPayments.filter(isPaidPayment);
      const linkedRefunds = paidPayments.flatMap((payment) => refundsByPaymentId.get(getId(payment)) || []);
      const bookingExpenses = expensesByReference.get(bookingReference) || [];
      const currency = getPrimaryCurrency(invoice, booking, paidPayments[0], bookingExpenses[0]);
      const bookedRevenue = roundMoney(invoice ? getInvoiceTotal(invoice) : booking?.pricingSnapshot?.finalPayable ?? booking?.amount ?? 0);
      const collectedRevenue = roundMoney(
        invoice ? getInvoicePaid(invoice) : paidPayments.reduce((sum, payment) => sum + getPaymentPaidAmount(payment), 0)
      );
      const refundedAmount = roundMoney(
        Math.max(
          getInvoiceRefunded(invoice || {}),
          toNumber(booking?.amountRefunded),
          linkedRefunds.reduce((sum, refund) => sum + getRefundConfirmedAmount(refund), 0)
        )
      );
      const paymentProviderFees = roundMoney(paidPayments.reduce((sum, payment) => sum + toNumber(payment.providerFeeAmount), 0));
      const actualDirectCost = roundMoney(
        bookingExpenses.reduce((sum, expense) => sum + toNumber(expense.baseCurrencyAmount ?? expense.amount), 0)
      );
      const netRevenue = roundMoney(collectedRevenue - refundedAmount - paymentProviderFees);
      const grossProfit = roundMoney(netRevenue - actualDirectCost);
      const profitMargin = netRevenue > 0 ? Number(((grossProfit / netRevenue) * 100).toFixed(2)) : 0;

      return {
        bookingReference,
        productTitle: booking?.productTitle || invoice?.tourName || "",
        salesChannel: booking?.salesChannel || "",
        bookingStatus: booking?.bookingStatus || invoice?.bookingStatus || "",
        paymentStatus: booking?.paymentStatus || invoice?.paymentStatus || "",
        currency,
        bookedRevenue,
        collectedRevenue,
        refundedAmount,
        paymentProviderFees,
        actualDirectCost,
        netRevenue,
        grossProfit,
        profitMargin,
        evidence: {
          invoice: Boolean(invoice),
          successfulPaymentCount: paidPayments.length,
          completedRefundCount: linkedRefunds.length,
          bookingLinkedExpenseCount: bookingExpenses.length
        }
      };
    });

    const totals = items.reduce(
      (summary, item) => {
        summary.bookedRevenue += item.bookedRevenue;
        summary.collectedRevenue += item.collectedRevenue;
        summary.refundedAmount += item.refundedAmount;
        summary.paymentProviderFees += item.paymentProviderFees;
        summary.actualDirectCost += item.actualDirectCost;
        summary.netRevenue += item.netRevenue;
        summary.grossProfit += item.grossProfit;
        return summary;
      },
      {
        bookedRevenue: 0,
        collectedRevenue: 0,
        refundedAmount: 0,
        paymentProviderFees: 0,
        actualDirectCost: 0,
        netRevenue: 0,
        grossProfit: 0
      }
    );
    Object.keys(totals).forEach((key) => {
      totals[key] = roundMoney(totals[key]);
    });
    totals.profitMargin = totals.netRevenue > 0 ? Number(((totals.grossProfit / totals.netRevenue) * 100).toFixed(2)) : 0;

    return {
      generatedAt: new Date().toISOString(),
      scan: { limit: scanLimit, boundedScan: true },
      totals,
      currency: items[0]?.currency || "USD",
      items: items
        .sort((left, right) => right.netRevenue - left.netRevenue)
        .slice(0, pagination(filters).limit),
      count: items.length
    };
  };

  const getReconciliation = async (filters = {}) => {
    const { bookings, invoices, payments, refunds, expenses, scanLimit } = await loadSnapshot(filters);
    const issues = buildReconciliationIssues({ bookings, invoices, payments, refunds, expenses });
    const search = normalizeLower(filters.search);
    const severity = normalizeUpper(filters.severity);
    const filtered = issues.filter((issue) => {
      if (severity && issue.severity !== severity) return false;
      if (!search) return true;
      return `${issue.code} ${issue.entityType} ${issue.reference} ${issue.message}`.toLowerCase().includes(search);
    });
    return {
      generatedAt: new Date().toISOString(),
      scan: { limit: scanLimit, boundedScan: true },
      items: filtered.slice(0, pagination(filters).limit),
      count: filtered.length,
      summary: {
        totalIssues: filtered.length,
        critical: filtered.filter((issue) => issue.severity === "CRITICAL").length,
        errors: filtered.filter((issue) => issue.severity === "ERROR").length,
        warnings: filtered.filter((issue) => issue.severity === "WARNING").length
      }
    };
  };

  const getDashboard = async (filters = {}) => {
    const [invoices, refunds, expenses, profitability, reconciliation] = await Promise.all([
      listInvoices({ ...filters, limit: 10 }),
      listRefunds({ ...filters, limit: 10 }),
      listExpenses({ ...filters, limit: 10 }),
      getProfitability({ ...filters, limit: 10 }),
      getReconciliation({ ...filters, limit: 25 })
    ]);

    const openRefunds = refunds.items.filter((refund) =>
      ["requested", "eligible", "pending_approval", "approved", "awaiting_merchant_approval", "processing", "verification_required"].includes(
        normalizeLower(refund.status)
      )
    );

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        invoiceCount: invoices.total,
        refundCount: refunds.total,
        bookingExpenseCount: expenses.total,
        openRefundCount: openRefunds.length,
        reconciliationIssueCount: reconciliation.count,
        collectedRevenue: profitability.totals.collectedRevenue,
        confirmedRefundedAmount: profitability.totals.refundedAmount,
        netRevenue: profitability.totals.netRevenue,
        grossProfit: profitability.totals.grossProfit,
        profitMargin: profitability.totals.profitMargin
      },
      currency: profitability.currency,
      recentInvoices: invoices.items,
      recentRefunds: refunds.items,
      recentExpenses: expenses.items,
      profitability: profitability.items,
      reconciliation: reconciliation.items.slice(0, 10)
    };
  };

  const getCostTemplates = async () => ({
    generatedAt: new Date().toISOString(),
    configured: false,
    templates: [],
    costBasisTypes: [
      "fixed_per_booking",
      "per_participant",
      "per_adult",
      "per_child",
      "per_vehicle",
      "per_group",
      "percentage",
      "tiered",
      "manual"
    ],
    controlledExpenseCategories: Object.values(EXPENSE_CATEGORY),
    currentEvidenceSource: "booking-linked BusinessExpense records and reconciliation checks",
    message: "No persistent ProductCostTemplate model is registered in this codebase."
  });

  return {
    getCostTemplates,
    getDashboard,
    getProfitability,
    getReconciliation,
    listExpenses,
    listInvoices,
    listRefunds
  };
};

const service = createBookingAccountingService();

module.exports = {
  ...service,
  createBookingAccountingService,
  __testables: {
    buildReconciliationIssues,
    getRefundConfirmedAmount,
    normalizeExpense,
    normalizeInvoice,
    normalizeRefund,
    roundMoney,
    toNumber
  }
};
