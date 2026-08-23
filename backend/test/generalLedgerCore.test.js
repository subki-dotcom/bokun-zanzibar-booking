process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/general-ledger-core-test";
process.env.JWT_SECRET ||= "general-ledger-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const { DEFAULT_CHART_OF_ACCOUNTS } = require("../src/accounting/defaultChartOfAccounts");
const {
  ACCOUNTING_PERIOD_STATUS,
  GL_ACCOUNT_TYPE,
  GL_POSTING_TYPE,
  JOURNAL_STATUS,
  SOURCE_MODULE
} = require("../src/accounting/constants");
const { createGeneralLedgerService } = require("../src/services/generalLedger/ledger");

const clone = (value) => JSON.parse(JSON.stringify(value));

const createFakeModels = () => {
  const state = {
    accounts: DEFAULT_CHART_OF_ACCOUNTS.map((account, index) => ({
      _id: `64d000000000000000000${String(index).padStart(3, "0")}`.slice(0, 24),
      ...clone(account),
      active: true,
      allowManualPosting: account.allowManualPosting !== false
    })),
    mappings: [],
    rules: [],
    periods: [],
    journals: [],
    lines: [],
    audits: [],
    migrationRuns: []
  };

  const valueAt = (row, key) => key.split(".").reduce((current, part) => current?.[part], row);
  const matches = (row, query = {}) =>
    Object.entries(query || {}).every(([key, value]) => {
      const actual = valueAt(row, key);
      if (value instanceof RegExp) return value.test(String(actual || ""));
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (value.$in) return value.$in.includes(actual);
        if (value.$ne !== undefined) return actual !== value.$ne;
        if (value.$lte || value.$gte) {
          const actualDate = new Date(actual);
          if (value.$lte && actualDate > new Date(value.$lte)) return false;
          if (value.$gte && actualDate < new Date(value.$gte)) return false;
          return true;
        }
      }
      return String(actual ?? "") === String(value ?? "");
    });

  const makeModel = (collectionName) => ({
    findOne: async (query) => {
      const found = state[collectionName].find((row) => matches(row, query));
      return found ? clone(found) : null;
    },
    find: async (query = {}) => state[collectionName].filter((row) => matches(row, query)).map(clone),
    findById: async (id) => {
      const found = state[collectionName].find((row) => String(row._id) === String(id));
      return found ? clone(found) : null;
    },
    findByIdAndUpdate: async (id, update) => {
      const index = state[collectionName].findIndex((row) => String(row._id) === String(id));
      if (index < 0) return null;
      state[collectionName][index] = {
        ...state[collectionName][index],
        ...clone(update.$set || {}),
        updatedAt: new Date("2026-08-20T12:00:00.000Z")
      };
      return clone(state[collectionName][index]);
    },
    countDocuments: async (query = {}) => state[collectionName].filter((row) => matches(row, query)).length,
    create: async (payload) => {
      const row = {
        _id: `64e000000000000000${String(state[collectionName].length + 1).padStart(6, "0")}`.slice(0, 24),
        ...clone(payload),
        createdAt: new Date("2026-08-20T11:00:00.000Z"),
        updatedAt: new Date("2026-08-20T11:00:00.000Z")
      };
      state[collectionName].push(row);
      return clone(row);
    },
    updateMany: async (query, update) => {
      state[collectionName] = state[collectionName].map((row) =>
        matches(row, query) ? { ...row, ...clone(update.$set || {}) } : row
      );
      return { modifiedCount: state[collectionName].filter((row) => matches(row, query)).length };
    }
  });

  const AuditLogModel = {
    create: async (payload) => {
      state.audits.push(clone(payload));
      return clone(payload);
    }
  };

  const EmptyCountModel = {
    countDocuments: async () => 0
  };

  const service = createGeneralLedgerService({
    AccountingMappingModel: makeModel("mappings"),
    AccountingPeriodModel: makeModel("periods"),
    AuditLogModel,
    BusinessExpenseModel: EmptyCountModel,
    BusinessIncomeModel: EmptyCountModel,
    ChartOfAccountModel: makeModel("accounts"),
    FixedAssetModel: makeModel("migrationRuns"),
    InvoiceModel: EmptyCountModel,
    JournalEntryModel: makeModel("journals"),
    JournalEntryLineModel: makeModel("lines"),
    LedgerMigrationRunModel: makeModel("migrationRuns"),
    PaymentModel: EmptyCountModel,
    PostingRuleModel: makeModel("rules"),
    RefundModel: EmptyCountModel,
    now: () => new Date("2026-08-20T11:00:00.000Z")
  });

  return { service, state };
};

test("balanced journal posts and unbalanced journal is blocked", async () => {
  const { service } = createFakeModels();

  const created = await service.createManualJournal({
    input: {
      postingDate: "2026-08-20T10:00:00.000Z",
      description: "Opening bank test",
      currency: "USD",
      requiresApproval: false,
      lines: [
        { accountCode: "1020", debit: "100" },
        { accountCode: "3010", credit: "100" }
      ]
    },
    auth: { id: "admin-1", role: "admin" }
  });
  const posted = await service.postJournal({
    journalId: created.journal.id,
    auth: { id: "admin-1", role: "admin" }
  });

  assert.equal(posted.journal.status, JOURNAL_STATUS.POSTED);

  await assert.rejects(
    () =>
      service.createManualJournal({
        input: {
          description: "Bad journal",
          currency: "USD",
          lines: [
            { accountCode: "1020", debit: "100" },
            { accountCode: "3010", credit: "99" }
          ]
        }
      }),
    /unbalanced/
  );
});

test("source event posting is idempotent and payment remains separate from revenue", async () => {
  const { service, state } = createFakeModels();

  const first = await service.postCustomerPayment({
    payment: {
      _id: "pay-1",
      bookingReference: "ZNZ-GL-1",
      provider: "pesapal",
      amountPaid: 100,
      currency: "USD",
      orderTrackingId: "trk-1"
    }
  });
  const second = await service.postCustomerPayment({
    payment: {
      _id: "pay-1",
      bookingReference: "ZNZ-GL-1",
      provider: "pesapal",
      amountPaid: 100,
      currency: "USD",
      orderTrackingId: "trk-1"
    }
  });

  assert.equal(first.action, "created");
  assert.equal(second.action, "existing");
  assert.equal(state.journals.length, 1);
  assert.equal(state.lines.filter((line) => line.postingType === GL_POSTING_TYPE.CUSTOMER_PAYMENT).length, 2);
});

test("posted journals are immutable and reversal nets the ledger to zero", async () => {
  const { service } = createFakeModels();
  const created = await service.createManualJournal({
    input: {
      description: "Capital injection",
      currency: "USD",
      requiresApproval: false,
      lines: [
        { accountCode: "1020", debit: "50" },
        { accountCode: "3010", credit: "50" }
      ]
    },
    auth: { id: "admin-1", role: "admin" }
  });
  await service.postJournal({ journalId: created.journal.id, auth: { id: "admin-1", role: "admin" } });

  await assert.rejects(
    () => service.approveJournal({ journalId: created.journal.id, auth: { id: "admin-2", role: "admin" } }),
    /immutable/
  );

  const reversed = await service.reverseJournal({
    journalId: created.journal.id,
    reason: "Test correction",
    auth: { id: "admin-2", role: "super_admin" }
  });
  assert.equal(reversed.action, "reversed");

  const trial = await service.getTrialBalance();
  assert.equal(trial.balanced, true);
  assert.equal(trial.totals.debit, "0");
  assert.equal(trial.totals.credit, "0");
});

test("closed period blocks ordinary posting", async () => {
  const { service } = createFakeModels();
  const period = await service.createOrGetPeriod({
    year: 2026,
    month: 8,
    auth: { id: "admin-1", role: "admin" }
  });
  await service.closePeriod({
    periodId: period.period._id,
    reason: "Month closed",
    auth: { id: "admin-1", role: "admin" }
  });

  await assert.rejects(
    () =>
      service.postCustomerPayment({
        payment: {
          _id: "pay-closed",
          bookingReference: "ZNZ-CLOSED",
          provider: "pesapal",
          amountPaid: 10,
          currency: "USD",
          paidAt: "2026-08-12T08:00:00.000Z"
        }
      }),
    /closed/
  );
});

test("invoice and payment create balanced trial balance and balance sheet", async () => {
  const { service } = createFakeModels();
  await service.postCustomerInvoice({
    invoice: {
      _id: "invoice-1",
      invoiceNumber: "INV-GL-1",
      bookingReference: "ZNZ-GL-1",
      total: 100,
      currency: "USD"
    },
    booking: {
      bookingReference: "ZNZ-GL-1",
      productTitle: "Stone Town Tour",
      currency: "USD"
    }
  });
  await service.postCustomerPayment({
    payment: {
      _id: "payment-1",
      bookingReference: "ZNZ-GL-1",
      provider: "pesapal",
      amountPaid: 100,
      currency: "USD",
      orderTrackingId: "trk-2"
    }
  });

  const trial = await service.getTrialBalance();
  const balance = await service.getBalanceSheet();
  assert.equal(trial.balanced, true);
  assert.equal(balance.balanced, true);
  assert.equal(balance.totals.assets, "100");
  assert.equal(balance.totals.equity, "100");
});

test("provider settlement with fee clears Pesapal balance", async () => {
  const { service } = createFakeModels();
  await service.postCustomerPayment({
    payment: {
      _id: "payment-settle",
      bookingReference: "ZNZ-GL-2",
      provider: "pesapal",
      amountPaid: 100,
      currency: "USD",
      orderTrackingId: "trk-3"
    }
  });
  await service.postProviderSettlement({
    settlement: {
      id: "settlement-1",
      provider: "pesapal",
      amount: 97,
      fee: 3,
      currency: "USD",
      reference: "SET-1"
    }
  });

  const ledger = await service.getGeneralLedger({ accountCode: "1030" });
  assert.equal(ledger.items.at(-1).runningBalance, "0");
});

test("historical migration dry-run writes nothing and apply requires evidence", async () => {
  const { service, state } = createFakeModels();
  const dryRun = await service.runHistoricalMigration({ dryRun: true });

  assert.equal(dryRun.writes, 0);
  assert.equal(state.migrationRuns.length, 0);
  await assert.rejects(() => service.runHistoricalMigration({ dryRun: false }), /evidence note/);
});

test("multi-currency journal preserves locked historical exchange rate", async () => {
  const { service, state } = createFakeModels();
  const created = await service.createManualJournal({
    input: {
      description: "EUR bank entry",
      currency: "EUR",
      baseCurrency: "USD",
      exchangeRate: "1.2",
      requiresApproval: false,
      lines: [
        { accountCode: "1020", debit: "10" },
        { accountCode: "3010", credit: "10" }
      ]
    }
  });

  assert.equal(created.journal.exchangeRate, "1.2");
  assert.equal(state.lines[0].baseCurrencyDebit.$numberDecimal || state.lines[0].baseCurrencyDebit, "12");
});
