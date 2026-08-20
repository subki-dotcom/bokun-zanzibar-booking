const AccountingPosting = require("../../models/AccountingPosting");
const AuditLog = require("../../models/AuditLog");
const BackupOperation = require("../../models/BackupOperation");
const Booking = require("../../models/Booking");
const BookingRequest = require("../../models/BookingRequest");
const BusinessExpense = require("../../models/BusinessExpense");
const BusinessIncome = require("../../models/BusinessIncome");
const Invoice = require("../../models/Invoice");
const Payment = require("../../models/Payment");
const Refund = require("../../models/Refund");
const ReportExport = require("../../models/ReportExport");
const SyncLog = require("../../models/SyncLog");
const SystemAlert = require("../../models/SystemAlert");

const REVIEW_STATUS = Object.freeze({
  COVERED: "covered",
  RECOMMENDED: "recommended",
  REVIEW_REQUIRED: "review_required"
});

const PRIORITY = Object.freeze({
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low"
});

const defaultModels = {
  AccountingPosting,
  AuditLog,
  BackupOperation,
  Booking,
  BookingRequest,
  BusinessExpense,
  BusinessIncome,
  Invoice,
  Payment,
  Refund,
  ReportExport,
  SyncLog,
  SystemAlert
};

const queryPatterns = Object.freeze([
  {
    id: "booking_operational_travel_analytics",
    model: "Booking",
    area: "analytics",
    priority: PRIORITY.CRITICAL,
    evidence: "Sales/product/channel/trend analytics filter operational Bokun travel dates by salesChannel and bookingStatus.",
    queryShape: {
      filter: ["salesChannel", "bookingStatus", "bokunOperationalDates.travelDate.normalizedAt"],
      sort: []
    },
    requiredIndex: { salesChannel: 1, bookingStatus: 1, "bokunOperationalDates.travelDate.normalizedAt": 1 }
  },
  {
    id: "booking_local_travel_date_channel",
    model: "Booking",
    area: "operations",
    priority: PRIORITY.HIGH,
    evidence: "Operational booking reports and dashboards group Bokun local travel dates by sales channel.",
    queryShape: {
      filter: ["bokunOperationalDates.travelDate.localDate", "salesChannel"],
      sort: []
    },
    requiredIndex: { "bokunOperationalDates.travelDate.localDate": 1, salesChannel: 1 }
  },
  {
    id: "booking_confirmed_import_last_modified",
    model: "Booking",
    area: "bokun_sync",
    priority: PRIORITY.HIGH,
    evidence: "Bokun confirmed-booking import/resync tracks last modified timestamps.",
    queryShape: {
      filter: ["bokunOperationalDates.bokunLastModifiedAt.normalizedAt"],
      sort: []
    },
    requiredIndex: { "bokunOperationalDates.bokunLastModifiedAt.normalizedAt": 1 }
  },
  {
    id: "booking_finalization_reconciliation",
    model: "Booking",
    area: "worker",
    priority: PRIORITY.CRITICAL,
    evidence: "Booking finalization worker scans paid bookings by supplier/finalization status and retry state.",
    queryShape: {
      filter: ["paymentStatus", "bokunBookingId", "bookingStatus", "pendingCheckout.finalization.status"],
      sort: []
    },
    requiredIndex: {
      paymentStatus: 1,
      bokunBookingId: 1,
      bokunConfirmationCode: 1,
      bookingStatus: 1,
      travelDate: 1,
      "pendingCheckout.finalization.status": 1,
      supplierStatus: 1,
      "legacyBokunRecovery.status": 1
    }
  },
  {
    id: "accounting_posting_financial_reports",
    model: "AccountingPosting",
    area: "reporting",
    priority: PRIORITY.CRITICAL,
    evidence: "BI/report center consume AccountingPosting by accountingScope, postingType, status and transactionDate.",
    queryShape: {
      filter: ["accountingScope", "postingType", "status", "transactionDate"],
      sort: ["transactionDate"]
    },
    requiredIndex: { accountingScope: 1, postingType: 1, status: 1, transactionDate: 1 }
  },
  {
    id: "business_expense_list_and_reports",
    model: "BusinessExpense",
    area: "business_accounting",
    priority: PRIORITY.HIGH,
    evidence: "Business expense lists and expense reports filter by accountingScope/category/status and expenseDate.",
    queryShape: {
      filter: ["accountingScope", "category", "status", "expenseDate"],
      sort: ["expenseDate", "createdAt"]
    },
    requiredIndex: { accountingScope: 1, category: 1, status: 1, expenseDate: 1 }
  },
  {
    id: "business_payables_due_date",
    model: "BusinessExpense",
    area: "reporting",
    priority: PRIORITY.HIGH,
    evidence: "Payables aging filters BusinessExpense paymentStatus and dueDate.",
    queryShape: {
      filter: ["paymentStatus", "dueDate"],
      sort: ["dueDate", "expenseDate"]
    },
    requiredIndex: { paymentStatus: 1, dueDate: 1 }
  },
  {
    id: "business_income_list_and_reports",
    model: "BusinessIncome",
    area: "business_accounting",
    priority: PRIORITY.HIGH,
    evidence: "Business income lists and income reports filter by accountingScope/incomeCategory/status and transactionDate.",
    queryShape: {
      filter: ["accountingScope", "incomeCategory", "status", "transactionDate"],
      sort: ["transactionDate", "createdAt"]
    },
    requiredIndex: { accountingScope: 1, incomeCategory: 1, status: 1, transactionDate: 1 }
  },
  {
    id: "payment_cash_flow_paid_at",
    model: "Payment",
    area: "reporting",
    priority: PRIORITY.HIGH,
    evidence: "Management cash flow reads paid customer payments by paidAt range and sort.",
    queryShape: {
      filter: ["status", "paidAt"],
      sort: ["paidAt", "createdAt"]
    },
    requiredIndex: { status: 1, paidAt: -1, createdAt: -1 }
  },
  {
    id: "payment_booking_verified_summary",
    model: "Payment",
    area: "payment_reconciliation",
    priority: PRIORITY.CRITICAL,
    evidence: "Payment allocation/finalization repeatedly loads paid payments by bookingReference sorted by verification time.",
    queryShape: {
      filter: ["bookingReference", "status"],
      sort: ["lastVerifiedAt", "updatedAt"]
    },
    requiredIndex: { bookingReference: 1, status: 1, lastVerifiedAt: -1, updatedAt: -1 }
  },
  {
    id: "payment_reconciliation_admin_list",
    model: "Payment",
    area: "admin_list",
    priority: PRIORITY.MEDIUM,
    evidence: "Payment reconciliation admin list loads recent payments sorted by updatedAt and createdAt.",
    queryShape: {
      filter: [],
      sort: ["updatedAt", "createdAt"]
    },
    requiredIndex: { updatedAt: -1, createdAt: -1 }
  },
  {
    id: "invoice_receivables_aging",
    model: "Invoice",
    area: "reporting",
    priority: PRIORITY.HIGH,
    evidence: "Receivables aging filters invoices by paymentStatus and issueDate, sorted by issueDate/createdAt.",
    queryShape: {
      filter: ["paymentStatus", "issueDate"],
      sort: ["issueDate", "createdAt"]
    },
    requiredIndex: { paymentStatus: 1, issueDate: -1, createdAt: -1 }
  },
  {
    id: "invoice_booking_payment_lookup",
    model: "Invoice",
    area: "payment_reconciliation",
    priority: PRIORITY.HIGH,
    evidence: "Payment reconciliation and invoice sync load invoice snapshots by bookingReference and paymentStatus.",
    queryShape: {
      filter: ["bookingReference", "paymentStatus"],
      sort: []
    },
    requiredIndex: { bookingReference: 1, paymentStatus: 1 }
  },
  {
    id: "refund_reconciliation_worker",
    model: "Refund",
    area: "worker",
    priority: PRIORITY.CRITICAL,
    evidence: "Refund reconciliation scans provider/status records by lastRefundSyncAt and updatedAt.",
    queryShape: {
      filter: ["provider", "status", "lastRefundSyncAt"],
      sort: ["lastRefundSyncAt", "updatedAt"]
    },
    requiredIndex: { provider: 1, status: 1, lastRefundSyncAt: 1, updatedAt: 1 }
  },
  {
    id: "refund_report_completion_date",
    model: "Refund",
    area: "reporting",
    priority: PRIORITY.HIGH,
    evidence: "Refund reports and dashboards need completed refunds by status and completedAt.",
    queryShape: {
      filter: ["status", "completedAt"],
      sort: ["completedAt"]
    },
    requiredIndex: { status: 1, completedAt: -1 }
  },
  {
    id: "audit_log_financial_changes",
    model: "AuditLog",
    area: "audit",
    priority: PRIORITY.HIGH,
    evidence: "Audit & Control financial changes filter entityType/action and sort by createdAt.",
    queryShape: {
      filter: ["entityType", "createdAt"],
      sort: ["createdAt"]
    },
    requiredIndex: { entityType: 1, entityId: 1, createdAt: -1 }
  },
  {
    id: "audit_log_actor_history",
    model: "AuditLog",
    area: "audit",
    priority: PRIORITY.MEDIUM,
    evidence: "Audit log filters include actorId/actorRole over createdAt.",
    queryShape: {
      filter: ["actorId", "createdAt"],
      sort: ["createdAt"]
    },
    requiredIndex: { actorId: 1, createdAt: -1 }
  },
  {
    id: "sync_log_history",
    model: "SyncLog",
    area: "monitoring",
    priority: PRIORITY.HIGH,
    evidence: "Bokun sync audit/history filters by operation/status and recent start time.",
    queryShape: {
      filter: ["operation", "status", "startedAt"],
      sort: ["startedAt"]
    },
    requiredIndex: { operation: 1, status: 1, startedAt: -1 }
  },
  {
    id: "report_export_history",
    model: "ReportExport",
    area: "reporting",
    priority: PRIORITY.MEDIUM,
    evidence: "Report export history filters reportType/format/status and sorts by generatedAt.",
    queryShape: {
      filter: ["reportType", "generatedAt"],
      sort: ["generatedAt"]
    },
    requiredIndex: { reportType: 1, generatedAt: -1 }
  },
  {
    id: "system_alert_ops_list",
    model: "SystemAlert",
    area: "monitoring",
    priority: PRIORITY.HIGH,
    evidence: "Ops Control lists alerts by state/severity/category and lastSeenAt.",
    queryShape: {
      filter: ["state", "severity", "category"],
      sort: ["lastSeenAt"]
    },
    requiredIndex: { state: 1, severity: 1, category: 1, lastSeenAt: -1 }
  },
  {
    id: "backup_operation_history",
    model: "BackupOperation",
    area: "disaster_recovery",
    priority: PRIORITY.MEDIUM,
    evidence: "Disaster Recovery lists backup/restore operations by type/status/requestedAt.",
    queryShape: {
      filter: ["type", "status"],
      sort: ["requestedAt"]
    },
    requiredIndex: { type: 1, status: 1, requestedAt: -1 }
  },
  {
    id: "booking_request_admin_queue",
    model: "BookingRequest",
    area: "operations",
    priority: PRIORITY.HIGH,
    evidence: "Admin request queues filter booking requests by booking/type/status and createdAt.",
    queryShape: {
      filter: ["booking", "type", "status"],
      sort: ["createdAt"]
    },
    requiredIndex: { booking: 1, type: 1, status: 1, createdAt: -1 }
  }
]);

const normalizeIndexSpec = (spec = {}) =>
  Object.entries(spec || {}).reduce((result, [key, value]) => {
    result[key] = Number(value) < 0 ? -1 : 1;
    return result;
  }, {});

const indexSignature = (spec = {}) =>
  Object.entries(normalizeIndexSpec(spec)).map(([key, value]) => `${key}:${value}`).join("|");

const declaredIndexesForModel = (Model) => {
  if (!Model?.schema?.indexes) return [];
  return Model.schema.indexes().map(([spec, options = {}]) => ({
    spec: normalizeIndexSpec(spec),
    options,
    signature: indexSignature(spec),
    name: options.name || ""
  }));
};

const indexCoversPattern = (declared = {}, required = {}) => {
  const declaredEntries = Object.entries(normalizeIndexSpec(declared));
  const requiredEntries = Object.entries(normalizeIndexSpec(required));
  if (!requiredEntries.length) return true;
  if (declaredEntries.length < requiredEntries.length) return false;
  return requiredEntries.every(([key, direction], index) => {
    const [declaredKey, declaredDirection] = declaredEntries[index] || [];
    return declaredKey === key && Number(declaredDirection) === Number(direction);
  });
};

const findCoveringIndex = (indexes = [], requiredIndex = {}) =>
  indexes.find((index) => indexCoversPattern(index.spec, requiredIndex)) || null;

const statusForPattern = ({ coveringIndex, pattern }) => {
  if (coveringIndex) return REVIEW_STATUS.COVERED;
  if ([PRIORITY.CRITICAL, PRIORITY.HIGH].includes(pattern.priority)) return REVIEW_STATUS.RECOMMENDED;
  return REVIEW_STATUS.REVIEW_REQUIRED;
};

const normalizePattern = ({ pattern, models }) => {
  const Model = models[pattern.model];
  const indexes = declaredIndexesForModel(Model);
  const coveringIndex = findCoveringIndex(indexes, pattern.requiredIndex);
  const status = statusForPattern({ coveringIndex, pattern });
  return {
    ...pattern,
    status,
    covered: status === REVIEW_STATUS.COVERED,
    migrationRequired: status !== REVIEW_STATUS.COVERED,
    requiredIndex: normalizeIndexSpec(pattern.requiredIndex),
    requiredIndexSignature: indexSignature(pattern.requiredIndex),
    coveringIndex: coveringIndex ? {
      spec: coveringIndex.spec,
      signature: coveringIndex.signature,
      name: coveringIndex.name,
      unique: Boolean(coveringIndex.options?.unique),
      partialFilterExpression: coveringIndex.options?.partialFilterExpression || null
    } : null,
    declaredIndexCount: indexes.length,
    recommendation: coveringIndex
      ? "Covered by declared Mongoose index."
      : "Add this index through a reviewed migration after validating duplicate/index build risk in production.",
    safeMigrationNotes: [
      "Run index creation in a maintenance window or with background/online index build support for the deployed MongoDB version.",
      "Validate existing duplicate data before adding unique indexes.",
      "Use dry-run explain plans against production-like data before applying new indexes."
    ]
  };
};

const createPerformanceReviewService = ({ models = defaultModels, patterns = queryPatterns, now = () => new Date() } = {}) => {
  const getIndexCoverage = ({ area = "", model = "", priority = "", status = "" } = {}) => {
    const normalized = patterns.map((pattern) => normalizePattern({ pattern, models }));
    const filtered = normalized.filter((item) => {
      if (area && item.area !== area) return false;
      if (model && item.model !== model) return false;
      if (priority && item.priority !== priority) return false;
      if (status && item.status !== status) return false;
      return true;
    });
    const counts = filtered.reduce((summary, item) => {
      summary.total += 1;
      summary.byStatus[item.status] = (summary.byStatus[item.status] || 0) + 1;
      summary.byPriority[item.priority] = (summary.byPriority[item.priority] || 0) + 1;
      summary.byArea[item.area] = (summary.byArea[item.area] || 0) + 1;
      if (item.covered) summary.covered += 1;
      if (item.migrationRequired) summary.migrationRequired += 1;
      return summary;
    }, {
      total: 0,
      covered: 0,
      migrationRequired: 0,
      byStatus: {},
      byPriority: {},
      byArea: {}
    });

    return {
      generatedAt: now().toISOString(),
      status: counts.migrationRequired === 0 ? "covered" : "review_required",
      coveragePercent: counts.total ? Number(((counts.covered / counts.total) * 100).toFixed(2)) : 100,
      counts,
      items: filtered,
      filters: { area, model, priority, status },
      rules: {
        noBlindIndexes: true,
        source: "Declared Mongoose schema indexes compared to known query patterns",
        doesNotApplyIndexes: true
      }
    };
  };

  const getModelIndexInventory = () => {
    const modelsList = Object.entries(models)
      .filter(([, Model]) => Model?.schema?.indexes)
      .map(([name, Model]) => ({
        model: name,
        collection: Model.collection?.name || "",
        indexes: declaredIndexesForModel(Model).map((index) => ({
          spec: index.spec,
          signature: index.signature,
          name: index.name,
          unique: Boolean(index.options?.unique),
          sparse: Boolean(index.options?.sparse),
          partialFilterExpression: index.options?.partialFilterExpression || null
        }))
      }))
      .sort((left, right) => left.model.localeCompare(right.model));

    return {
      generatedAt: now().toISOString(),
      models: modelsList,
      count: modelsList.length
    };
  };

  const getSummary = () => {
    const coverage = getIndexCoverage();
    const criticalMissing = coverage.items.filter((item) => item.priority === PRIORITY.CRITICAL && !item.covered);
    return {
      generatedAt: coverage.generatedAt,
      status: criticalMissing.length ? "critical_review_required" : coverage.status,
      coveragePercent: coverage.coveragePercent,
      counts: coverage.counts,
      criticalMissing,
      nextActions: coverage.items
        .filter((item) => item.migrationRequired)
        .slice(0, 10)
        .map((item) => ({
          id: item.id,
          model: item.model,
          area: item.area,
          priority: item.priority,
          requiredIndex: item.requiredIndex,
          evidence: item.evidence
        })),
      safeguards: [
        "This module reviews declared indexes and query evidence only; it does not create or drop indexes.",
        "Indexes should be applied through a reviewed migration with dry-run explain-plan evidence.",
        "Financial/report formulas are not duplicated or changed by this review."
      ]
    };
  };

  return {
    getIndexCoverage,
    getModelIndexInventory,
    getSummary
  };
};

const service = createPerformanceReviewService();

module.exports = {
  ...service,
  PRIORITY,
  REVIEW_STATUS,
  createPerformanceReviewService,
  queryPatterns,
  __testables: {
    declaredIndexesForModel,
    findCoveringIndex,
    indexCoversPattern,
    indexSignature,
    normalizeIndexSpec
  }
};
