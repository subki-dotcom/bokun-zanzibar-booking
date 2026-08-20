process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/audit-control-core-test";
process.env.JWT_SECRET ||= "audit-control-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const AuditLog = require("../src/models/AuditLog");
const {
  createAuditControlService,
  __testables
} = require("../src/services/auditControl");

const fixedNow = new Date("2026-08-16T09:30:00.000Z");

const createFakeAuditModel = (records = []) => {
  const state = {
    lastQuery: null,
    lastSort: null,
    lastSkip: null,
    lastLimit: null
  };

  return {
    state,
    model: {
      find: (query) => {
        state.lastQuery = query;
        return {
          sort: (sortValue) => {
            state.lastSort = sortValue;
            return {
              skip: (skipValue) => {
                state.lastSkip = skipValue;
                return {
                  limit: (limitValue) => {
                    state.lastLimit = limitValue;
                    return {
                      lean: async () => records.slice(skipValue, skipValue + limitValue)
                    };
                  }
                };
              }
            };
          }
        };
      },
      countDocuments: async () => records.length
    }
  };
};

test("audit control lists immutable audit logs with sanitized before, after and metadata", async () => {
  const harness = createFakeAuditModel([
    {
      _id: "audit-1",
      actorId: "admin-1",
      actorRole: "admin",
      action: "business_expense_updated",
      entityType: "BusinessExpense",
      entityId: "expense-1",
      reason: "Corrected receipt amount",
      requestId: "req-audit-1",
      before: {
        bookingReference: "ZNZ-AUD-1",
        amount: "75",
        cardNumber: "1234567890123456"
      },
      after: {
        bookingReference: "ZNZ-AUD-1",
        amount: "90"
      },
      metadata: {
        access_token: "secret-token",
        providerPayload: {
          confirmationCode: "26607935178085"
        }
      },
      createdAt: "2026-08-16T08:00:00.000Z"
    }
  ]);
  const service = createAuditControlService({
    AuditLogModel: harness.model,
    now: () => fixedNow
  });

  const result = await service.listAuditLogs({
    reference: "ZNZ-AUD-1",
    page: 1,
    limit: 10
  });

  assert.equal(result.generatedAt, "2026-08-16T09:30:00.000Z");
  assert.equal(result.immutable, true);
  assert.equal(result.secretsSanitized, true);
  assert.equal(result.pagination.total, 1);
  assert.equal(harness.state.lastSkip, 0);
  assert.equal(harness.state.lastLimit, 10);
  assert.equal(result.items[0].reference, "ZNZ-AUD-1");
  assert.equal(result.items[0].correlationId, "req-audit-1");
  assert.equal(result.items[0].before.cardNumber, "[redacted]");
  assert.equal(result.items[0].metadata.access_token, "[redacted]");
  assert.equal(result.items[0].changeSummary.moneyChanged, true);
  assert.equal(result.items[0].changeSummary.changedFields[0].field, "amount");
});

test("financial change view answers who changed money, what changed, when and why", async () => {
  const harness = createFakeAuditModel([
    {
      _id: "audit-financial-1",
      actorId: "admin-2",
      actorRole: "admin",
      action: "business_income_updated",
      entityType: "BusinessIncome",
      entityId: "income-1",
      reason: "Approved verified receipt",
      before: { amount: "20", status: "draft" },
      after: { amount: "150", status: "approved", reference: "RCPT-1" },
      createdAt: "2026-08-16T08:00:00.000Z"
    },
    {
      _id: "audit-non-financial-1",
      actorId: "system",
      actorRole: "bokun_import",
      action: "bokun_confirmed_booking_imported",
      entityType: "Booking",
      entityId: "booking-1",
      after: { bookingReference: "ZNZ-NON-FIN" },
      createdAt: "2026-08-16T07:00:00.000Z"
    }
  ]);
  const service = createAuditControlService({
    AuditLogModel: harness.model,
    now: () => fixedNow
  });

  const result = await service.listFinancialChanges({
    minAmount: 100,
    limit: 20
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].actor.id, "admin-2");
  assert.equal(result.items[0].entity.type, "BusinessIncome");
  assert.equal(result.items[0].changeSummary.changedFields[0].field, "amount");
  assert.equal(result.items[0].changeSummary.maxAbsoluteAmount, 150);
  assert.deepEqual(result.viewAnswers.whoChangedTheMoney, [{ id: "admin-2", role: "admin" }]);
  assert.deepEqual(result.viewAnswers.whatChanged[0].changedFields, ["amount"]);
  assert.deepEqual(result.viewAnswers.whenChanged, ["2026-08-16T08:00:00.000Z"]);
  assert.deepEqual(result.viewAnswers.whyChanged, ["Approved verified receipt"]);
});

test("audit query builders support financial evidence and reference filtering", () => {
  const auditQuery = __testables.buildBaseQuery({
    actorId: "admin-1",
    reference: "ZNZ-AUD-1",
    fromDate: "2026-08-01",
    toDate: "2026-08-31"
  });
  const financialQuery = __testables.buildFinancialQuery({
    reference: "ZNZ-AUD-1"
  });

  assert.equal(auditQuery.actorId, "admin-1");
  assert.ok(auditQuery.createdAt.$gte instanceof Date);
  assert.ok(auditQuery.createdAt.$lte instanceof Date);
  assert.equal(auditQuery.$or.length > 3, true);
  assert.equal(Array.isArray(financialQuery.$and), true);
  assert.equal(financialQuery.$and.length, 2);
});

test("AuditLog model blocks direct update and delete operations", async () => {
  await assert.rejects(
    () => AuditLog.updateOne({ entityId: "audit-immutable-1" }, { $set: { reason: "changed" } }).exec(),
    (error) => error.code === "AUDIT_LOG_IMMUTABLE"
  );

  await assert.rejects(
    () => AuditLog.deleteOne({ entityId: "audit-immutable-1" }).exec(),
    (error) => error.code === "AUDIT_LOG_IMMUTABLE"
  );
});
