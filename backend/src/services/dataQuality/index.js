const { BUSINESS_UNIT, EXPENSE_CATEGORY } = require("../../accounting/constants");
const { SALES_CHANNEL } = require("../../integrations/bokun/salesChannel.adapter");
const AccountingPosting = require("../../models/AccountingPosting");
const Booking = require("../../models/Booking");
const BusinessExpense = require("../../models/BusinessExpense");
const BusinessIncome = require("../../models/BusinessIncome");
const Invoice = require("../../models/Invoice");
const Payment = require("../../models/Payment");
const Refund = require("../../models/Refund");

const DATA_QUALITY_SEVERITY = Object.freeze({
  INFO: "INFO",
  WARNING: "WARNING",
  ERROR: "ERROR",
  CRITICAL: "CRITICAL"
});

const DATA_QUALITY_ISSUE = Object.freeze({
  MISSING_ACTUAL_COST: "MISSING_ACTUAL_COST",
  MISSING_SALES_CHANNEL: "MISSING_SALES_CHANNEL",
  MISSING_BOKUN_DATE: "MISSING_BOKUN_DATE",
  MISSING_FX: "MISSING_FX",
  MISSING_INVOICE: "MISSING_INVOICE",
  MISSING_PAYMENT_LINK: "MISSING_PAYMENT_LINK",
  MISSING_SUPPLIER: "MISSING_SUPPLIER",
  UNALLOCATED_BUSINESS_UNIT: "UNALLOCATED_BUSINESS_UNIT",
  UNKNOWN_EXPENSE_CATEGORY: "UNKNOWN_EXPENSE_CATEGORY",
  DUPLICATE_SUSPICION: "DUPLICATE_SUSPICION",
  RECONCILIATION_MISMATCH: "RECONCILIATION_MISMATCH",
  REFUND_EVIDENCE_MISSING: "REFUND_EVIDENCE_MISSING"
});

const ISSUE_DEFINITION = Object.freeze({
  [DATA_QUALITY_ISSUE.MISSING_ACTUAL_COST]: {
    severity: DATA_QUALITY_SEVERITY.WARNING,
    category: "COSTS",
    recommendedAction: "Add actual direct-cost evidence or confirm that no direct cost applies."
  },
  [DATA_QUALITY_ISSUE.MISSING_SALES_CHANNEL]: {
    severity: DATA_QUALITY_SEVERITY.WARNING,
    category: "SALES_CHANNEL",
    recommendedAction: "Map the raw booking channel to a normalized sales channel."
  },
  [DATA_QUALITY_ISSUE.MISSING_BOKUN_DATE]: {
    severity: DATA_QUALITY_SEVERITY.ERROR,
    category: "BOKUN_OPERATIONS",
    recommendedAction: "Resync the booking from Bokun and preserve the returned operational date fields."
  },
  [DATA_QUALITY_ISSUE.MISSING_FX]: {
    severity: DATA_QUALITY_SEVERITY.ERROR,
    category: "FX",
    recommendedAction: "Record the historical exchange rate used for this cross-currency financial record."
  },
  [DATA_QUALITY_ISSUE.MISSING_INVOICE]: {
    severity: DATA_QUALITY_SEVERITY.ERROR,
    category: "INVOICE",
    recommendedAction: "Sync or create the invoice from the canonical booking accounting record."
  },
  [DATA_QUALITY_ISSUE.MISSING_PAYMENT_LINK]: {
    severity: DATA_QUALITY_SEVERITY.ERROR,
    category: "PAYMENT",
    recommendedAction: "Link the payment to the booking/invoice or mark the record for reconciliation."
  },
  [DATA_QUALITY_ISSUE.MISSING_SUPPLIER]: {
    severity: DATA_QUALITY_SEVERITY.WARNING,
    category: "SUPPLIER",
    recommendedAction: "Attach a supplier/payee to this expense."
  },
  [DATA_QUALITY_ISSUE.UNALLOCATED_BUSINESS_UNIT]: {
    severity: DATA_QUALITY_SEVERITY.WARNING,
    category: "BUSINESS_UNIT",
    recommendedAction: "Assign the record to the correct business unit."
  },
  [DATA_QUALITY_ISSUE.UNKNOWN_EXPENSE_CATEGORY]: {
    severity: DATA_QUALITY_SEVERITY.WARNING,
    category: "EXPENSE_CATEGORY",
    recommendedAction: "Map the expense to one of the controlled expense categories."
  },
  [DATA_QUALITY_ISSUE.DUPLICATE_SUSPICION]: {
    severity: DATA_QUALITY_SEVERITY.CRITICAL,
    category: "DUPLICATE",
    recommendedAction: "Review the duplicate source references before relying on totals."
  },
  [DATA_QUALITY_ISSUE.RECONCILIATION_MISMATCH]: {
    severity: DATA_QUALITY_SEVERITY.ERROR,
    category: "RECONCILIATION",
    recommendedAction: "Run reconciliation and correct the mismatched source record."
  },
  [DATA_QUALITY_ISSUE.REFUND_EVIDENCE_MISSING]: {
    severity: DATA_QUALITY_SEVERITY.WARNING,
    category: "REFUNDS",
    recommendedAction: "Attach provider-specific refund evidence or audited manual confirmation."
  }
});

const defaultModels = {
  AccountingPostingModel: AccountingPosting,
  BookingModel: Booking,
  BusinessExpenseModel: BusinessExpense,
  BusinessIncomeModel: BusinessIncome,
  InvoiceModel: Invoice,
  PaymentModel: Payment,
  RefundModel: Refund
};

const normalizeToken = (value = "") => String(value || "").trim();
const normalizeUpper = (value = "") => normalizeToken(value).toUpperCase();
const isBlank = (value) => normalizeToken(value) === "";
const isPresent = (value) => value !== null && value !== undefined && normalizeToken(value) !== "";
const getId = (record = {}) => normalizeToken(record.id || record._id);
const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const toIso = (value) => {
  const date = toDate(value);
  return date ? date.toISOString() : "";
};

const decimalLikeToNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "$numberDecimal")) {
    const parsed = Number(value.$numberDecimal);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && value._bsontype === "Decimal128" && typeof value.toString === "function") {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const dateMatches = (record = {}, { fromDate = "", toDate: endDate = "" } = {}) => {
  const from = toDate(fromDate);
  const to = toDate(endDate);
  if (!from && !to) return true;
  const candidates = [
    record.createdAt,
    record.updatedAt,
    record.issueDate,
    record.paidAt,
    record.transactionDate,
    record.expenseDate,
    record.completedAt,
    record.requestedAt,
    record.bokunOperationalDates?.bookingCreatedAtBokun?.normalizedAt,
    record.bokunOperationalDates?.travelDate?.normalizedAt
  ].map(toDate).filter(Boolean);
  if (!candidates.length) return false;
  return candidates.some((date) => (!from || date >= from) && (!to || date <= to));
};

const loadCollection = async (Model, { limit = 1000, filters = {}, sort = { createdAt: -1 } } = {}) => {
  if (!Model?.find) return [];
  const found = Model.find({});
  if (Array.isArray(found)) {
    return found.filter((record) => dateMatches(record, filters)).slice(0, limit);
  }
  if (found && typeof found.then === "function" && !found.sort) {
    const resolved = await found;
    return Array.isArray(resolved) ? resolved.filter((record) => dateMatches(record, filters)).slice(0, limit) : [];
  }

  let query = found;
  if (query.sort) query = query.sort(sort);
  if (query.limit) query = query.limit(limit);
  if (query.lean) query = query.lean();
  const records = await query;
  return (records || []).filter((record) => dateMatches(record, filters)).slice(0, limit);
};

const pushMap = (map, key, value) => {
  const normalized = normalizeToken(key);
  if (!normalized) return;
  const existing = map.get(normalized) || [];
  existing.push(value);
  map.set(normalized, existing);
};

const buildMap = (records, keyFn) => {
  const map = new Map();
  records.forEach((record) => pushMap(map, keyFn(record), record));
  return map;
};

const hasSuccessfulPayment = (payment = {}) =>
  payment.status === "paid" ||
  payment.paymentStatus === "paid" ||
  payment.verificationStatus === "verified" ||
  Number(payment.amountPaid || payment.paidAmount || 0) > 0;

const getDirectCostEvidence = ({ booking = {}, posting = null } = {}) => {
  if (Array.isArray(booking.directBookingCosts) && booking.directBookingCosts.length > 0) return "booking.directBookingCosts";
  if (Array.isArray(booking.costs) && booking.costs.length > 0) return "booking.costs";
  const postingCost = posting?.components?.directBookingCosts;
  if (postingCost !== null && postingCost !== undefined && normalizeToken(postingCost) !== "") {
    return "accountingPosting.components.directBookingCosts";
  }
  return "";
};

const hasBokunOperationalDate = (booking = {}) => {
  const dates = booking.bokunOperationalDates || {};
  return Boolean(
    dates.travelDate?.normalizedAt ||
      dates.travelDate?.localDate ||
      dates.activityDate?.normalizedAt ||
      dates.activityDate?.localDate
  );
};

const hasCrossCurrencyMissingFx = (record = {}) => {
  const currency = normalizeUpper(record.currency || record.chargedCurrency || record.orderCurrency);
  const baseCurrency = normalizeUpper(record.baseCurrency || record.accountingCurrency || record.settlementCurrency);
  if (!currency || !baseCurrency || currency === baseCurrency) return false;
  return !isPresent(record.exchangeRate) && !isPresent(record.fxRate) && !isPresent(record.historicalFxRate);
};

const hasInvoiceBalanceMismatch = (invoice = {}) => {
  const total = decimalLikeToNumber(invoice.totalAmount ?? invoice.total);
  const paid = decimalLikeToNumber(invoice.paidAccountingAmount ?? invoice.amountPaid);
  const refunded = decimalLikeToNumber(invoice.refundedAccountingAmount ?? invoice.amountRefunded) || 0;
  const balance = decimalLikeToNumber(invoice.balanceDueAmount ?? invoice.balanceDue);
  if (total === null || paid === null || balance === null) return false;
  const expected = Number((total - paid + refunded).toFixed(2));
  return Math.abs(expected - balance) > 0.01;
};

const addIssue = (issues, { code, entityType, entityId, reference = "", message, evidence = {}, severity = "", category = "", recommendedAction = "" }) => {
  const definition = ISSUE_DEFINITION[code] || {};
  issues.push({
    code,
    severity: severity || definition.severity || DATA_QUALITY_SEVERITY.WARNING,
    category: category || definition.category || "DATA_QUALITY",
    entityType,
    entityId: normalizeToken(entityId),
    reference: normalizeToken(reference),
    message,
    evidence,
    recommendedAction: recommendedAction || definition.recommendedAction || ""
  });
};

const addDuplicateIssues = ({ issues, records, keyFn, entityType, referenceFn, field }) => {
  const groups = buildMap(records, keyFn);
  groups.forEach((rows, key) => {
    if (!key || rows.length < 2) return;
    rows.forEach((record) => {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.DUPLICATE_SUSPICION,
        entityType,
        entityId: getId(record),
        reference: referenceFn(record),
        message: `${entityType} has a duplicate ${field}.`,
        evidence: {
          field,
          value: key,
          duplicateCount: rows.length
        }
      });
    });
  });
};

const evaluateBookings = ({ issues, bookings, invoicesByBookingReference, paymentsByBookingReference, postingsByBookingReference }) => {
  bookings.forEach((booking) => {
    const bookingReference = booking.bookingReference || "";
    const invoices = invoicesByBookingReference.get(bookingReference) || [];
    const payments = paymentsByBookingReference.get(bookingReference) || [];
    const posting = (postingsByBookingReference.get(bookingReference) || [])[0] || null;
    const isConfirmed = booking.bookingStatus === "confirmed" || booking.bokunStatus?.normalized === "confirmed";
    const isPaid = booking.paymentStatus === "paid";

    if (!booking.salesChannel || booking.salesChannel === SALES_CHANNEL.OTHER) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.MISSING_SALES_CHANNEL,
        entityType: "Booking",
        entityId: getId(booking),
        reference: bookingReference,
        message: "Booking is missing a trusted normalized sales channel.",
        evidence: {
          salesChannel: booking.salesChannel || "",
          rawChannelSource: booking.rawChannelSource || booking.bokunImport?.rawSalesChannel || ""
        }
      });
    }

    if (booking.operationalSource === "BOKUN" && isConfirmed && !hasBokunOperationalDate(booking)) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.MISSING_BOKUN_DATE,
        entityType: "Booking",
        entityId: getId(booking),
        reference: bookingReference,
        message: "Confirmed Bokun booking is missing operational travel/activity date evidence.",
        evidence: {
          operationalSource: booking.operationalSource,
          bokunStatus: booking.bokunStatus?.normalized || "",
          travelDate: booking.travelDate || ""
        }
      });
    }

    if (isConfirmed && !getDirectCostEvidence({ booking, posting })) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.MISSING_ACTUAL_COST,
        entityType: "Booking",
        entityId: getId(booking),
        reference: bookingReference,
        message: "Confirmed booking is missing actual direct-cost evidence.",
        evidence: {
          bookingHasDirectCosts: Array.isArray(booking.directBookingCosts) && booking.directBookingCosts.length > 0,
          postingHasDirectCosts: isPresent(posting?.components?.directBookingCosts)
        }
      });
    }

    if ((isConfirmed || isPaid) && invoices.length === 0) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.MISSING_INVOICE,
        entityType: "Booking",
        entityId: getId(booking),
        reference: bookingReference,
        message: "Confirmed/paid booking has no linked invoice record.",
        evidence: {
          bookingStatus: booking.bookingStatus || "",
          paymentStatus: booking.paymentStatus || ""
        }
      });
    }

    if (isPaid && !payments.some(hasSuccessfulPayment)) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.MISSING_PAYMENT_LINK,
        entityType: "Booking",
        entityId: getId(booking),
        reference: bookingReference,
        message: "Booking is marked paid but has no linked successful payment record.",
        evidence: {
          paymentStatus: booking.paymentStatus,
          linkedPaymentCount: payments.length
        }
      });
    }

    const invoice = invoices[0];
    const bookingTotal = decimalLikeToNumber(booking.pricingSnapshot?.finalPayable ?? booking.amount);
    const invoiceTotal = decimalLikeToNumber(invoice?.totalAmount ?? invoice?.total);
    if (bookingTotal !== null && invoiceTotal !== null && Math.abs(bookingTotal - invoiceTotal) > 0.01) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.RECONCILIATION_MISMATCH,
        entityType: "Booking",
        entityId: getId(booking),
        reference: bookingReference,
        message: "Booking amount does not match the linked invoice total.",
        evidence: {
          bookingAmount: bookingTotal,
          invoiceTotal
        }
      });
    }
  });

  addDuplicateIssues({
    issues,
    records: bookings.filter((booking) => isPresent(booking.bokunBookingId)),
    keyFn: (booking) => booking.bokunBookingId,
    entityType: "Booking",
    referenceFn: (booking) => booking.bookingReference,
    field: "bokunBookingId"
  });
};

const evaluateInvoices = ({ issues, invoices, paymentsByBookingReference }) => {
  invoices.forEach((invoice) => {
    const reference = invoice.bookingReference || invoice.invoiceNumber || "";
    const payments = paymentsByBookingReference.get(invoice.bookingReference || "") || [];
    if (invoice.paymentStatus === "paid" && !payments.some(hasSuccessfulPayment)) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.MISSING_PAYMENT_LINK,
        entityType: "Invoice",
        entityId: getId(invoice),
        reference,
        message: "Invoice is marked paid but has no linked successful payment.",
        evidence: {
          invoiceNumber: invoice.invoiceNumber || "",
          paymentStatus: invoice.paymentStatus || ""
        }
      });
    }

    if (hasInvoiceBalanceMismatch(invoice)) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.RECONCILIATION_MISMATCH,
        entityType: "Invoice",
        entityId: getId(invoice),
        reference,
        message: "Invoice balance fields do not reconcile with total, paid and refunded amounts.",
        evidence: {
          total: invoice.total,
          amountPaid: invoice.amountPaid,
          amountRefunded: invoice.amountRefunded,
          balanceDue: invoice.balanceDue
        }
      });
    }
  });
};

const evaluatePayments = ({ issues, payments, bookingsByReference }) => {
  payments.forEach((payment) => {
    const reference = payment.bookingReference || payment.merchantReference || payment.intentId || "";
    const booking = bookingsByReference.get(payment.bookingReference || "")?.[0] || null;

    if (payment.bookingReference && !booking) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.MISSING_PAYMENT_LINK,
        entityType: "Payment",
        entityId: getId(payment),
        reference,
        message: "Payment points to a booking reference that does not exist locally.",
        evidence: {
          bookingReference: payment.bookingReference,
          provider: payment.provider || ""
        }
      });
    }

    if (hasCrossCurrencyMissingFx(payment)) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.MISSING_FX,
        entityType: "Payment",
        entityId: getId(payment),
        reference,
        message: "Cross-currency payment is missing historical FX evidence.",
        evidence: {
          chargedCurrency: payment.chargedCurrency || payment.orderCurrency || payment.currency || "",
          accountingCurrency: payment.accountingCurrency || payment.settlementCurrency || "",
          fxRate: payment.fxRate || ""
        }
      });
    }

    if (
      payment.anomaly?.flagged ||
      ["amount_mismatch", "currency_review_required", "reference_mismatch"].includes(payment.verificationStatus) ||
      payment.accountingAllocationStatus === "blocked"
    ) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.RECONCILIATION_MISMATCH,
        entityType: "Payment",
        entityId: getId(payment),
        reference,
        message: "Payment has provider/accounting reconciliation evidence that needs review.",
        evidence: {
          verificationStatus: payment.verificationStatus || "",
          accountingAllocationStatus: payment.accountingAllocationStatus || "",
          anomaly: payment.anomaly || {}
        }
      });
    }
  });

  addDuplicateIssues({
    issues,
    records: payments.filter((payment) => isPresent(payment.providerTransactionId)),
    keyFn: (payment) => `${payment.provider || ""}:${payment.providerTransactionId || ""}`,
    entityType: "Payment",
    referenceFn: (payment) => payment.bookingReference || payment.intentId,
    field: "providerTransactionId"
  });
  addDuplicateIssues({
    issues,
    records: payments.filter((payment) => isPresent(payment.orderTrackingId)),
    keyFn: (payment) => `${payment.provider || ""}:${payment.orderTrackingId || ""}`,
    entityType: "Payment",
    referenceFn: (payment) => payment.bookingReference || payment.intentId,
    field: "orderTrackingId"
  });
};

const evaluateRefunds = ({ issues, refunds, bookingsById, bookingsByReference }) => {
  refunds.forEach((refund) => {
    const booking = bookingsById.get(normalizeToken(refund.bookingId))?.[0] || bookingsByReference.get(refund.bookingReference || "")?.[0] || null;
    const reference = booking?.bookingReference || refund.refundReference || "";
    const completed = ["refunded", "partially_refunded"].includes(refund.status);
    const amount = Number(refund.confirmedRefundedAmount || 0);

    if (completed && amount <= 0) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.RECONCILIATION_MISMATCH,
        entityType: "Refund",
        entityId: getId(refund),
        reference,
        message: "Refund is completed but confirmed refunded amount is zero.",
        evidence: {
          status: refund.status,
          confirmedRefundedAmount: refund.confirmedRefundedAmount || 0
        }
      });
    }

    if (completed) {
      const hasGenericReference = isPresent(refund.providerRefundReference) || isPresent(refund.providerRefundRequestReference);
      const hasPesapalEvidence =
        refund.provider === "pesapal" &&
        (hasGenericReference || isPresent(refund.originalTransactionReference) || isPresent(refund.originalProviderTransactionId));
      const hasProviderEvidence = refund.provider === "pesapal" ? hasPesapalEvidence : isPresent(refund.providerRefundReference);
      if (!hasProviderEvidence) {
        addIssue(issues, {
          code: DATA_QUALITY_ISSUE.REFUND_EVIDENCE_MISSING,
          entityType: "Refund",
          entityId: getId(refund),
          reference,
          message: "Completed refund is missing provider-specific evidence.",
          evidence: {
            provider: refund.provider || "",
            providerRefundReference: refund.providerRefundReference || "",
            providerRefundRequestReference: refund.providerRefundRequestReference || "",
            originalTransactionReference: refund.originalTransactionReference || ""
          }
        });
      }
    }
  });
};

const evaluateExpenses = ({ issues, expenses }) => {
  const allowedCategories = new Set(Object.values(EXPENSE_CATEGORY));
  expenses.forEach((expense) => {
    const reference = expense.expenseReference || expense.sourceReference || "";
    if (isBlank(expense.supplier?.name) && isBlank(expense.supplier?.supplierId)) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.MISSING_SUPPLIER,
        entityType: "BusinessExpense",
        entityId: getId(expense),
        reference,
        message: "Business expense is missing supplier/payee evidence.",
        evidence: {
          category: expense.category || "",
          supplier: expense.supplier || {}
        }
      });
    }

    if (expense.businessUnit === BUSINESS_UNIT.UNALLOCATED) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.UNALLOCATED_BUSINESS_UNIT,
        entityType: "BusinessExpense",
        entityId: getId(expense),
        reference,
        message: "Business expense is not allocated to a business unit.",
        evidence: {
          businessUnit: expense.businessUnit
        }
      });
    }

    if (!expense.category || !allowedCategories.has(expense.category)) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.UNKNOWN_EXPENSE_CATEGORY,
        entityType: "BusinessExpense",
        entityId: getId(expense),
        reference,
        message: "Business expense category is missing or outside the controlled category list.",
        evidence: {
          category: expense.category || ""
        }
      });
    }

    if (hasCrossCurrencyMissingFx(expense)) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.MISSING_FX,
        entityType: "BusinessExpense",
        entityId: getId(expense),
        reference,
        message: "Cross-currency expense is missing historical FX evidence.",
        evidence: {
          currency: expense.currency || "",
          baseCurrency: expense.baseCurrency || "",
          exchangeRate: expense.exchangeRate || ""
        }
      });
    }
  });
};

const evaluateIncomes = ({ issues, incomes }) => {
  incomes.forEach((income) => {
    const reference = income.incomeReference || income.reference || income.sourceReference || "";
    if (income.businessUnit === BUSINESS_UNIT.UNALLOCATED) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.UNALLOCATED_BUSINESS_UNIT,
        entityType: "BusinessIncome",
        entityId: getId(income),
        reference,
        message: "Business income is not allocated to a business unit.",
        evidence: {
          businessUnit: income.businessUnit
        }
      });
    }

    if (hasCrossCurrencyMissingFx(income)) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.MISSING_FX,
        entityType: "BusinessIncome",
        entityId: getId(income),
        reference,
        message: "Cross-currency income is missing historical FX evidence.",
        evidence: {
          currency: income.currency || "",
          baseCurrency: income.baseCurrency || "",
          exchangeRate: income.exchangeRate || ""
        }
      });
    }
  });
};

const evaluatePostings = ({ issues, postings }) => {
  postings.forEach((posting) => {
    const reference = posting.bookingReference || posting.sourceReference || posting.postingKey || "";
    if (posting.businessUnit === BUSINESS_UNIT.UNALLOCATED) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.UNALLOCATED_BUSINESS_UNIT,
        entityType: "AccountingPosting",
        entityId: getId(posting),
        reference,
        message: "Accounting posting is not allocated to a business unit.",
        evidence: {
          postingType: posting.postingType || "",
          businessUnit: posting.businessUnit
        }
      });
    }

    if (hasCrossCurrencyMissingFx(posting)) {
      addIssue(issues, {
        code: DATA_QUALITY_ISSUE.MISSING_FX,
        entityType: "AccountingPosting",
        entityId: getId(posting),
        reference,
        message: "Cross-currency accounting posting is missing historical FX evidence.",
        evidence: {
          currency: posting.currency || "",
          baseCurrency: posting.baseCurrency || "",
          exchangeRate: posting.exchangeRate || ""
        }
      });
    }
  });
};

const filterIssues = (issues, filters = {}) => {
  const severity = normalizeUpper(filters.severity);
  const code = normalizeUpper(filters.code);
  const entityType = normalizeToken(filters.entityType);
  const reference = normalizeToken(filters.reference).toLowerCase();

  return issues.filter((issue) => {
    if (severity && issue.severity !== severity) return false;
    if (code && issue.code !== code) return false;
    if (entityType && issue.entityType !== entityType) return false;
    if (reference && !`${issue.reference} ${issue.entityId}`.toLowerCase().includes(reference)) return false;
    return true;
  });
};

const buildSummary = ({ recordsByType, issues, generatedAt, scanLimit, filters }) => {
  const allRecordKeys = [];
  Object.entries(recordsByType).forEach(([entityType, records]) => {
    records.forEach((record) => {
      allRecordKeys.push(`${entityType}:${getId(record) || record.bookingReference || record.invoiceNumber || record.intentId || record.refundReference || record.expenseReference || record.incomeReference || record.postingKey}`);
    });
  });
  const incompleteKeys = new Set(issues.map((issue) => `${issue.entityType}:${issue.entityId}`));
  const totalRecords = allRecordKeys.length;
  const incompleteRecords = allRecordKeys.filter((key) => incompleteKeys.has(key)).length;
  const completeRecords = Math.max(0, totalRecords - incompleteRecords);

  const severityCounts = Object.values(DATA_QUALITY_SEVERITY).reduce((counts, severity) => {
    counts[severity] = issues.filter((issue) => issue.severity === severity).length;
    return counts;
  }, {});
  const issueCountsByCode = Object.values(DATA_QUALITY_ISSUE).reduce((counts, code) => {
    const count = issues.filter((issue) => issue.code === code).length;
    if (count > 0) counts[code] = count;
    return counts;
  }, {});
  const byEntityType = Object.fromEntries(
    Object.entries(recordsByType).map(([entityType, records]) => {
      const entityIssues = issues.filter((issue) => issue.entityType === entityType);
      const entityIncomplete = new Set(entityIssues.map((issue) => issue.entityId)).size;
      const total = records.length;
      return [
        entityType,
        {
          totalRecords: total,
          completeRecords: Math.max(0, total - entityIncomplete),
          incompleteRecords: entityIncomplete,
          issueCount: entityIssues.length,
          completenessPercent: total > 0 ? Number((((total - entityIncomplete) / total) * 100).toFixed(2)) : 100
        }
      ];
    })
  );

  return {
    generatedAt: generatedAt.toISOString(),
    scan: {
      fromDate: filters.fromDate || "",
      toDate: filters.toDate || "",
      scanLimit,
      sampledRecords: totalRecords,
      boundedScan: true
    },
    summary: {
      totalRecords,
      completeRecords,
      incompleteRecords,
      completenessPercent: totalRecords > 0 ? Number(((completeRecords / totalRecords) * 100).toFixed(2)) : 100,
      issueCount: issues.length,
      severityCounts,
      issueCountsByCode
    },
    byEntityType,
    topIssues: Object.entries(issueCountsByCode)
      .map(([code, count]) => ({
        code,
        count,
        severity: ISSUE_DEFINITION[code]?.severity || DATA_QUALITY_SEVERITY.WARNING
      }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 10),
    severityLevels: Object.values(DATA_QUALITY_SEVERITY),
    issueDefinitions: Object.fromEntries(
      Object.entries(ISSUE_DEFINITION).map(([code, definition]) => [
        code,
        {
          severity: definition.severity,
          category: definition.category,
          recommendedAction: definition.recommendedAction
        }
      ])
    ),
    limitations: [
      "This module reports data-quality evidence and does not rewrite historical financial records.",
      "Large datasets are scanned within the requested scanLimit until asynchronous quality jobs are added in a later phase."
    ]
  };
};

const createDataQualityService = ({ models = defaultModels, now = () => new Date() } = {}) => {
  const runScan = async (filters = {}) => {
    const scanLimit = Math.min(Math.max(Number(filters.limit || 1000), 1), 5000);
    const [
      bookings,
      invoices,
      payments,
      refunds,
      expenses,
      incomes,
      postings
    ] = await Promise.all([
      loadCollection(models.BookingModel, { limit: scanLimit, filters }),
      loadCollection(models.InvoiceModel, { limit: scanLimit, filters }),
      loadCollection(models.PaymentModel, { limit: scanLimit, filters }),
      loadCollection(models.RefundModel, { limit: scanLimit, filters }),
      loadCollection(models.BusinessExpenseModel, { limit: scanLimit, filters }),
      loadCollection(models.BusinessIncomeModel, { limit: scanLimit, filters }),
      loadCollection(models.AccountingPostingModel, { limit: scanLimit, filters })
    ]);

    const issues = [];
    const recordsByType = {
      Booking: bookings,
      Invoice: invoices,
      Payment: payments,
      Refund: refunds,
      BusinessExpense: expenses,
      BusinessIncome: incomes,
      AccountingPosting: postings
    };
    const bookingsByReference = buildMap(bookings, (booking) => booking.bookingReference);
    const bookingsById = buildMap(bookings, (booking) => getId(booking));
    const invoicesByBookingReference = buildMap(invoices, (invoice) => invoice.bookingReference);
    const paymentsByBookingReference = buildMap(payments, (payment) => payment.bookingReference);
    const postingsByBookingReference = buildMap(postings, (posting) => posting.bookingReference || posting.sourceReference);

    evaluateBookings({
      issues,
      bookings,
      invoicesByBookingReference,
      paymentsByBookingReference,
      postingsByBookingReference
    });
    evaluateInvoices({ issues, invoices, paymentsByBookingReference });
    evaluatePayments({ issues, payments, bookingsByReference });
    evaluateRefunds({ issues, refunds, bookingsById, bookingsByReference });
    evaluateExpenses({ issues, expenses });
    evaluateIncomes({ issues, incomes });
    evaluatePostings({ issues, postings });

    const filteredIssues = filterIssues(issues, filters);
    return {
      recordsByType,
      issues: filteredIssues,
      allIssues: issues,
      scanLimit,
      generatedAt: now()
    };
  };

  const getSummary = async (filters = {}) => {
    const result = await runScan(filters);
    return buildSummary({
      recordsByType: result.recordsByType,
      issues: result.allIssues,
      generatedAt: result.generatedAt,
      scanLimit: result.scanLimit,
      filters
    });
  };

  const listIssues = async (filters = {}) => {
    const result = await runScan(filters);
    const limit = Math.min(Math.max(Number(filters.issueLimit || filters.limit || 100), 1), 500);
    return {
      generatedAt: result.generatedAt.toISOString(),
      items: result.issues.slice(0, limit),
      count: result.issues.slice(0, limit).length,
      totalMatchingIssues: result.issues.length,
      filters: {
        severity: filters.severity || "",
        code: filters.code || "",
        entityType: filters.entityType || "",
        reference: filters.reference || ""
      },
      scan: {
        scanLimit: result.scanLimit,
        boundedScan: true
      }
    };
  };

  return {
    getSummary,
    listIssues
  };
};

const service = createDataQualityService();

module.exports = {
  ...service,
  createDataQualityService,
  DATA_QUALITY_ISSUE,
  DATA_QUALITY_SEVERITY,
  __testables: {
    buildSummary,
    dateMatches,
    filterIssues,
    hasCrossCurrencyMissingFx,
    hasInvoiceBalanceMismatch
  }
};
