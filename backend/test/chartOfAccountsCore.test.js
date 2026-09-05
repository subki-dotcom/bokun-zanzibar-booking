process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/chart-of-accounts-core-test";
process.env.JWT_SECRET ||= "chart-of-accounts-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  GL_ACCOUNT_NORMAL_BALANCE,
  GL_ACCOUNT_SUBTYPE,
  GL_ACCOUNT_TYPE
} = require("../src/accounting/constants");
const {
  createChartOfAccountsService,
  __testables
} = require("../src/services/generalLedger/chartOfAccounts");

const clone = (value) => JSON.parse(JSON.stringify(value));

const createFakeModels = () => {
  const state = {
    accounts: [],
    audits: []
  };

  const matches = (row, query = {}) =>
    Object.entries(query).every(([key, value]) => {
      if (key === "$or") {
        return value.some((condition) => matches(row, condition));
      }
      if (value instanceof RegExp) {
        return value.test(String(row[key] || ""));
      }
      if (value && typeof value === "object" && Array.isArray(value.$in)) {
        return value.$in.includes(row[key]);
      }
      if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "$ne")) {
        return String(row[key] || "") !== String(value.$ne || "");
      }
      return String(row[key] || "") === String(value || "");
    });

  const ChartOfAccountModel = {
    findOne: async (query) => {
      const found = state.accounts.find((account) => matches(account, query));
      return found ? clone(found) : null;
    },
    find: async (query = {}) => state.accounts.filter((account) => matches(account, query)).map(clone),
    findById: async (id) => {
      const found = state.accounts.find((account) => String(account._id) === String(id));
      return found ? clone(found) : null;
    },
    create: async (payload) => {
      const row = {
        _id: `64c0000000000000000000${String(state.accounts.length + 1).padStart(2, "0")}`,
        ...clone(payload),
        createdAt: new Date("2026-08-20T10:00:00.000Z"),
        updatedAt: new Date("2026-08-20T10:00:00.000Z")
      };
      state.accounts.push(row);
      return clone(row);
    },
    findByIdAndUpdate: async (id, update) => {
      const index = state.accounts.findIndex((account) => String(account._id) === String(id));
      if (index < 0) return null;
      state.accounts[index] = {
        ...state.accounts[index],
        ...clone(update.$set || {}),
        updatedAt: new Date("2026-08-20T10:30:00.000Z")
      };
      return clone(state.accounts[index]);
    }
  };

  const AuditLogModel = {
    create: async (payload) => {
      state.audits.push(clone(payload));
      return clone(payload);
    }
  };

  return {
    state,
    service: createChartOfAccountsService({
      AuditLogModel,
      ChartOfAccountModel,
      now: () => new Date("2026-08-20T11:00:00.000Z")
    })
  };
};

test("chart account code ranges enforce account type", () => {
  assert.doesNotThrow(() =>
    __testables.assertCodeMatchesType({
      code: "1010",
      type: GL_ACCOUNT_TYPE.ASSET
    })
  );

  assert.throws(
    () =>
      __testables.assertCodeMatchesType({
        code: "1010",
        type: GL_ACCOUNT_TYPE.REVENUE
      }),
    /code range/
  );
});

test("default chart seed dry-run performs zero writes", async () => {
  const { service, state } = createFakeModels();

  const result = await service.seedDefaultChart({
    dryRun: true,
    auth: { id: "admin-1", role: "admin" },
    requestId: "coa-dry-run"
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.willCreate > 20, true);
  assert.equal(state.accounts.length, 0);
  assert.equal(state.audits.length, 0);
});

test("default chart seed apply is idempotent and writes audit", async () => {
  const { service, state } = createFakeModels();

  const first = await service.seedDefaultChart({
    dryRun: false,
    auth: { id: "admin-1", role: "admin" },
    requestId: "coa-apply-1"
  });
  const countAfterFirst = state.accounts.length;
  const second = await service.seedDefaultChart({
    dryRun: false,
    auth: { id: "admin-1", role: "admin" },
    requestId: "coa-apply-2"
  });

  assert.equal(first.createdCount, countAfterFirst);
  assert.equal(first.createdCount > 20, true);
  assert.equal(second.createdCount, 0);
  assert.equal(state.accounts.length, countAfterFirst);
  assert.equal(state.audits.length, 2);
  assert.equal(state.accounts.some((account) => account.code === "1030" && account.name === "Pesapal Clearing"), true);
});

test("manual chart account creation prevents duplicates and normalizes API response", async () => {
  const { service } = createFakeModels();

  const created = await service.createAccount({
    input: {
      code: "6090",
      name: "Training Expense",
      type: GL_ACCOUNT_TYPE.EXPENSE,
      subtype: GL_ACCOUNT_SUBTYPE.OPERATING_EXPENSE,
      description: "Staff and guide training"
    },
    auth: { id: "admin-1", role: "admin" },
    requestId: "coa-create"
  });

  assert.equal(created.action, "created");
  assert.equal(created.account.code, "6090");
  assert.equal(created.account.normalBalance, GL_ACCOUNT_NORMAL_BALANCE.DEBIT);

  await assert.rejects(
    () =>
      service.createAccount({
        input: {
          code: "6090",
          name: "Duplicate Training Expense",
          type: GL_ACCOUNT_TYPE.EXPENSE,
          subtype: GL_ACCOUNT_SUBTYPE.OPERATING_EXPENSE
        }
      }),
    /already exists/
  );
});

test("chart account listing returns paginated accounts with full summary and hierarchy", async () => {
  const { service } = createFakeModels();
  await service.seedDefaultChart({ dryRun: false, auth: { id: "admin-1", role: "admin" } });

  const result = await service.listAccounts({
    status: "all",
    page: 2,
    limit: 5,
    sortBy: "code",
    sortDirection: "asc"
  });

  assert.equal(result.items.length, 5);
  assert.equal(result.pagination.page, 2);
  assert.equal(result.pagination.limit, 5);
  assert.equal(result.pagination.total > result.items.length, true);
  assert.equal(result.summary.total, result.pagination.total);
  assert.equal(result.summary.byType.some((row) => row.type === GL_ACCOUNT_TYPE.ASSET && row.count > 0), true);
  assert.equal(result.numberingPolicy.some((row) => row.range === "1xxx" && row.label === "Assets"), true);
  assert.equal(result.hierarchy.some((row) => row.code === "1000" && row.children.some((child) => child.code === "1030")), true);
  assert.equal(result.items.every((row) => row.typeLabel && row.status && row.systemLabel), true);
});

test("chart account listing supports search, status, ownership and hierarchy filters", async () => {
  const { service, state } = createFakeModels();
  await service.seedDefaultChart({ dryRun: false, auth: { id: "admin-1", role: "admin" } });
  const pesapal = state.accounts.find((account) => account.code === "1030");
  await service.updateAccount({
    accountId: pesapal._id,
    input: {
      name: "Pesapal Clearing Account",
      description: "Gateway settlement account"
    },
    auth: { id: "admin-1", role: "admin" }
  });

  const result = await service.listAccounts({
    search: "gateway",
    status: "active",
    systemAccount: "system",
    hasParent: true,
    limit: 25
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].code, "1030");
  assert.equal(result.items[0].parentLabel, "1000 - Current Assets");
  assert.equal(result.summary.total, 1);
});

test("system chart accounts cannot have structural fields changed", async () => {
  const { service, state } = createFakeModels();
  await service.seedDefaultChart({ dryRun: false, auth: { id: "admin-1", role: "admin" } });
  const pesapal = state.accounts.find((account) => account.code === "1030");

  await assert.rejects(
    () =>
      service.updateAccount({
        accountId: pesapal._id,
        input: {
          type: GL_ACCOUNT_TYPE.EXPENSE
        },
        auth: { id: "admin-1", role: "admin" }
      }),
    /structural fields/
  );
});
