const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createSupplierPayment,
  reserveAllocations,
  sourceMapping
} = require("../src/services/supplierPayments");

const query = (value) => ({ lean: async () => value });

const mappingModels = () => ({
  findOne: () => query({ mappingKey: "BANK", accountCode: "1020", active: true })
});

const accountModels = () => ({
  findOne: () => query({ code: "1020", name: "Operating Bank", active: true, type: "ASSET", subtype: "BANK" })
});

const paymentInput = (overrides = {}) => ({
  paymentReference: "SP-1001",
  idempotencyKey: "SP-1001",
  amount: "100",
  currency: "USD",
  baseCurrency: "USD",
  baseCurrencyAmount: "100",
  paymentMethod: "BANK",
  allocations: [{ expenseId: "expense-1", amount: "100", baseCurrencyAmount: "100" }],
  ...overrides
});

test("supplier source mapping requires an active cash or bank account", async () => {
  const source = await sourceMapping("BANK", { MappingModel: mappingModels(), AccountModel: accountModels() });
  assert.equal(source.accountCode, "1020");

  await assert.rejects(
    () => sourceMapping("BANK", {
      MappingModel: mappingModels(),
      AccountModel: { findOne: () => query({ code: "1020", active: true, type: "LIABILITY", subtype: "CURRENT_LIABILITY" }) }
    }),
    (error) => error.code === "SUPPLIER_PAYMENT_SOURCE_ACCOUNT_INVALID"
  );
});

test("posted supplier payment replay returns the existing payment before AP validation", async () => {
  const posted = { _id: "payment-1", status: "POSTED", journalEntryId: "journal-1" };
  const PaymentModel = {
    findOne: () => query(posted)
  };

  const result = await createSupplierPayment({
    input: paymentInput({ amount: "120", baseCurrencyAmount: "120" }),
    PaymentModel,
    MappingModel: mappingModels(),
    AccountModel: accountModels()
  });

  assert.equal(result.action, "existing");
  assert.equal(result.payment, posted);
});

test("concurrent supplier reservations allow only one payment to consume the AP balance", async () => {
  const expense = { _id: "expense-1", baseCurrencyAmount: 100, supplierPaymentAllocations: [] };
  const ExpenseModel = {
    updateOne: async (filter, update) => {
      const requested = Number(update.$push.supplierPaymentAllocations.baseCurrencyAmount);
      const used = expense.supplierPaymentAllocations.reduce((sum, row) => sum + Number(row.baseCurrencyAmount), 0);
      if (used + requested > Number(expense.baseCurrencyAmount)) return { matchedCount: 0 };
      expense.supplierPaymentAllocations.push(update.$push.supplierPaymentAllocations);
      return { matchedCount: 1 };
    },
    updateMany: async () => ({ matchedCount: 0 })
  };
  const PaymentModel = {
    findOneAndUpdate: () => query({ _id: "payment-1", allocationsReservedAt: new Date() })
  };
  const payment = { _id: "payment-1", allocations: [{ expenseId: "expense-1", amount: "100", baseCurrencyAmount: "100" }] };

  const results = await Promise.allSettled([
    reserveAllocations(payment, { PaymentModel, ExpenseModel }),
    reserveAllocations({ ...payment, _id: "payment-2" }, { PaymentModel, ExpenseModel })
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(expense.supplierPaymentAllocations.length, 1);
});

test("cross-currency supplier payment requires explicit FX evidence", async () => {
  const PaymentModel = { findOne: () => query(null) };
  const ExpenseModel = { find: () => query([{ _id: "expense-1", baseCurrencyAmount: 100, supplierPaymentAllocations: [] }]) };

  await assert.rejects(
    () => createSupplierPayment({
      input: paymentInput({ currency: "EUR", baseCurrency: "USD" }),
      PaymentModel,
      ExpenseModel,
      MappingModel: mappingModels(),
      AccountModel: accountModels()
    }),
    (error) => error.code === "SUPPLIER_PAYMENT_FX_EVIDENCE_REQUIRED"
  );
});

test("supplier payment accepts a full settlement when allocation equals AP", async () => {
  const PaymentModel = {
    findOne: () => query(null),
    findOneAndUpdate: () => ({ _id: "payment-1", status: "DRAFT" })
  };
  const ExpenseModel = {
    find: () => query([{ _id: "expense-1", baseCurrencyAmount: 100, supplierPaymentAllocations: [] }])
  };

  const result = await createSupplierPayment({
    input: paymentInput(),
    PaymentModel,
    ExpenseModel,
    MappingModel: mappingModels(),
    AccountModel: accountModels()
  });

  assert.equal(result.action, "preview");
  assert.equal(result.payment?._id, "payment-1");
});

test("supplier payment accepts a partial settlement against remaining AP", async () => {
  const PaymentModel = {
    findOne: () => query(null),
    findOneAndUpdate: () => ({ _id: "payment-1", status: "DRAFT" })
  };
  const ExpenseModel = {
    find: () => query([{ _id: "expense-1", baseCurrencyAmount: 100, supplierPaymentAllocations: [{ baseCurrencyAmount: "40" }] }])
  };

  const result = await createSupplierPayment({
    input: paymentInput({ amount: "60", baseCurrencyAmount: "60", allocations: [{ expenseId: "expense-1", amount: "60", baseCurrencyAmount: "60" }] }),
    PaymentModel,
    ExpenseModel,
    MappingModel: mappingModels(),
    AccountModel: accountModels()
  });

  assert.equal(result.action, "preview");
});

test("supplier payment rejects an allocation above outstanding AP", async () => {
  const PaymentModel = { findOne: () => query(null) };
  const ExpenseModel = {
    find: () => query([{ _id: "expense-1", baseCurrencyAmount: 100, supplierPaymentAllocations: [{ baseCurrencyAmount: "40" }] }])
  };

  await assert.rejects(
    () => createSupplierPayment({
      input: paymentInput({ amount: "61", baseCurrencyAmount: "61", allocations: [{ expenseId: "expense-1", amount: "61", baseCurrencyAmount: "61" }] }),
      PaymentModel,
      ExpenseModel,
      MappingModel: mappingModels(),
      AccountModel: accountModels()
    }),
    (error) => error.code === "SUPPLIER_PAYMENT_OVER_ALLOCATION"
  );
});

test("supplier payment rejects a draft expense before reserving AP", async () => {
  const PaymentModel = { findOne: () => query(null) };
  const ExpenseModel = {
    find: () => query([{ _id: "expense-1", status: "DRAFT", baseCurrencyAmount: 100, supplierPaymentAllocations: [] }])
  };

  await assert.rejects(
    () => createSupplierPayment({
      input: paymentInput(),
      PaymentModel,
      ExpenseModel,
      MappingModel: mappingModels(),
      AccountModel: accountModels()
    }),
    (error) => error.code === "SUPPLIER_PAYMENT_EXPENSE_NOT_ELIGIBLE"
  );
});

test("a complete existing supplier journal is recovered without reposting", async () => {
  const previousFlag = process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED;
  const previousMode = process.env.EXPENSE_POSTING_MODE;
  process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED = "true";
  process.env.EXPENSE_POSTING_MODE = "AUTOMATIC_SUPPLIER_PAYMENT_POSTING";
  const payment = { _id: "payment-1", status: "DRAFT", journalEntryId: null, allocations: [] };
  const updatedPayment = { ...payment, status: "POSTED", journalEntryId: "journal-1" };
  let paymentUpdates = 0;
  const PaymentModel = {
    findOne: () => query(null),
    findOneAndUpdate: () => {
      paymentUpdates += 1;
      return paymentUpdates === 1 ? payment : query(updatedPayment);
    }
  };
  const JournalModel = {
    findOne: () => query({ _id: "journal-1", status: "POSTED", lineCount: 2, postedAt: new Date() })
  };
  const LineModel = {
    find: () => query([{ journalEntryId: "journal-1" }, { journalEntryId: "journal-1" }])
  };
  let posts = 0;

  try {
    const result = await createSupplierPayment({
      input: paymentInput(),
      PaymentModel,
      ExpenseModel: { find: () => query([{ _id: "expense-1", baseCurrencyAmount: 100, supplierPaymentAllocations: [] }]) },
      MappingModel: mappingModels(),
      AccountModel: accountModels(),
      JournalModel,
      LineModel,
      LedgerService: { postSupplierPayment: async () => { posts += 1; } }
    });

    assert.equal(result.action, "recovered");
    assert.equal(posts, 0);
  } finally {
    if (previousFlag === undefined) delete process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED;
    else process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED = previousFlag;
    if (previousMode === undefined) delete process.env.EXPENSE_POSTING_MODE;
    else process.env.EXPENSE_POSTING_MODE = previousMode;
  }
});

test("a retry accepts an allocation already reserved by the same payment", async () => {
  const payment = { _id: "payment-1", allocations: [{ expenseId: "expense-1", amount: "100", baseCurrencyAmount: "100" }] };
  const expense = { _id: "expense-1", baseCurrencyAmount: 100, supplierPaymentAllocations: [{ paymentId: "payment-1", baseCurrencyAmount: "100" }] };
  const ExpenseModel = {
    updateOne: async () => ({ matchedCount: 0 }),
    findOne: () => query(expense)
  };
  const PaymentModel = { findOneAndUpdate: () => query({ ...payment, allocationsReservedAt: new Date() }) };

  const result = await reserveAllocations(payment, { PaymentModel, ExpenseModel });
  assert.equal(result.allocationsReservedAt instanceof Date, true);
});

test("an incomplete existing supplier journal moves the payment to review", async () => {
  const previousFlag = process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED;
  const previousMode = process.env.EXPENSE_POSTING_MODE;
  process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED = "true";
  process.env.EXPENSE_POSTING_MODE = "AUTOMATIC_SUPPLIER_PAYMENT_POSTING";
  const payment = { _id: "payment-1", status: "DRAFT", journalEntryId: null, allocations: [] };
  let reviewUpdate;
  const auditEvents = [];
  let paymentUpdates = 0;
  const PaymentModel = {
    findOne: () => query(null),
    findOneAndUpdate: () => {
      paymentUpdates += 1;
      return paymentUpdates === 1 ? payment : query({ ...payment, status: "NEEDS_REVIEW" });
    },
    updateOne: async (filter, update) => { reviewUpdate = { filter, update }; }
  };
  const JournalModel = {
    findOne: () => query({ _id: "journal-1", status: "DRAFT", lineCount: 2 })
  };
  const LineModel = {
    find: () => query([{ journalEntryId: "journal-1" }])
  };

  try {
    await assert.rejects(
      () => createSupplierPayment({
        input: paymentInput(),
        PaymentModel,
        ExpenseModel: { find: () => query([{ _id: "expense-1", baseCurrencyAmount: 100, supplierPaymentAllocations: [] }]) },
        MappingModel: mappingModels(),
        AccountModel: accountModels(),
        JournalModel,
        LineModel,
        LedgerService: { postSupplierPayment: async () => { throw new Error("must not post"); } },
        AuditLogModel: { create: async (event) => { auditEvents.push(event); } }
      }),
      (error) => error.code === "SUPPLIER_PAYMENT_JOURNAL_INCOMPLETE"
    );

    assert.equal(reviewUpdate.update.$set.status, "NEEDS_REVIEW");
  assert.equal(auditEvents[1].action, "supplier_payment_needs_review");
  assert.equal(auditEvents[1].after.status, "NEEDS_REVIEW");
  } finally {
    if (previousFlag === undefined) delete process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED;
    else process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED = previousFlag;
    if (previousMode === undefined) delete process.env.EXPENSE_POSTING_MODE;
    else process.env.EXPENSE_POSTING_MODE = previousMode;
  }
});

test("a closed accounting period leaves a supplier payment retryable", async () => {
  const previousFlag = process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED;
  const previousMode = process.env.EXPENSE_POSTING_MODE;
  process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED = "true";
  process.env.EXPENSE_POSTING_MODE = "AUTOMATIC_SUPPLIER_PAYMENT_POSTING";
  let failureUpdate;
  const auditEvents = [];
  const payment = { _id: "payment-1", status: "DRAFT", allocations: paymentInput().allocations };
  const PaymentModel = {
    findOne: () => query(null),
    findOneAndUpdate: (filter) => (filter.status || Object.prototype.hasOwnProperty.call(filter, "allocationsReservedAt") ? query({ ...payment, status: "POSTING", allocationsReservedAt: new Date() }) : payment),
    updateOne: async (filter, update) => { failureUpdate = update; }
  };
  try {
    await assert.rejects(
      () => createSupplierPayment({
        input: paymentInput(),
        PaymentModel,
        ExpenseModel: { find: () => query([{ _id: "expense-1", baseCurrencyAmount: 100, supplierPaymentAllocations: [] }]), updateOne: async () => ({ matchedCount: 1 }), updateMany: async () => ({}) },
        MappingModel: mappingModels(),
        AccountModel: accountModels(),
        JournalModel: { findOne: () => query(null) },
        LineModel: { find: () => query([]) },
        LedgerService: { postSupplierPayment: async () => { throw Object.assign(new Error("Accounting period is closed; provider token=secret-value 1234567890123456"), { code: "GL_PERIOD_CLOSED" }); } },
        AuditLogModel: { create: async (event) => { auditEvents.push(event); } }
      }),
      (error) => error.code === "GL_PERIOD_CLOSED"
    );
    assert.equal(failureUpdate.$set.status, "FAILED_RETRYABLE");
    assert.equal(auditEvents.at(-1).action, "supplier_payment_failed_retryable");
    assert.equal(auditEvents.at(-1).metadata.errorCode, "GL_PERIOD_CLOSED");
    assert.equal(auditEvents.at(-1).reason.includes("secret-value"), false);
    assert.equal(auditEvents.at(-1).reason.includes("1234567890123456"), false);
  } finally {
    if (previousFlag === undefined) delete process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED;
    else process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED = previousFlag;
    if (previousMode === undefined) delete process.env.EXPENSE_POSTING_MODE;
    else process.env.EXPENSE_POSTING_MODE = previousMode;
  }
});

test("supplier payment records an immutable lifecycle audit trail", async () => {
  const previousFlag = process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED;
  const previousMode = process.env.EXPENSE_POSTING_MODE;
  process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED = "true";
  process.env.EXPENSE_POSTING_MODE = "AUTOMATIC_SUPPLIER_PAYMENT_POSTING";
  const auditEvents = [];
  const draft = { _id: "payment-1", status: "DRAFT", accountingStatus: "DRAFT", allocations: paymentInput().allocations, amount: "100", baseCurrencyAmount: "100", currency: "USD", baseCurrency: "USD", paymentMethod: "BANK", paymentReference: "SP-1001" };
  const claimed = { ...draft, status: "POSTING", accountingStatus: "POSTING", allocationsReservedAt: null };
  const reserved = { ...claimed, allocationsReservedAt: new Date() };
  const posted = { ...reserved, status: "POSTED", accountingStatus: "POSTED", journalEntryId: "journal-1" };
  let updateCalls = 0;
  const PaymentModel = {
    findOne: () => query(null),
    findOneAndUpdate: (filter) => {
      updateCalls += 1;
      if (updateCalls === 1) return draft;
      if (updateCalls === 2) return query(claimed);
      if (updateCalls === 3) return query(reserved);
      if (updateCalls === 4) return query(posted);
      return query({ ...posted, allocationsAppliedAt: new Date() });
    },
    updateOne: async () => ({ matchedCount: 1 })
  };
  const ExpenseModel = {
    find: () => query([{ _id: "expense-1", baseCurrencyAmount: 100, supplierPaymentAllocations: [] }]),
    updateOne: async () => ({ matchedCount: 1 }),
    updateMany: async () => ({ matchedCount: 0 })
  };
  const AuditLogModel = {
    create: async (event) => { auditEvents.push(event); }
  };

  try {
    const result = await createSupplierPayment({
      input: paymentInput(),
      auth: { id: "admin-1", role: "SUPER_ADMIN", password: "must-not-be-audit-payload" },
      requestId: "req-1",
      PaymentModel,
      ExpenseModel,
      MappingModel: mappingModels(),
      AccountModel: accountModels(),
      JournalModel: { findOne: () => query(null) },
      LineModel: { find: () => query([]) },
      LedgerService: { postSupplierPayment: async () => ({ journal: { id: "journal-1" } }) },
      AuditLogModel
    });

    assert.equal(result.action, "posted");
    assert.deepEqual(auditEvents.map((event) => event.action), [
      "supplier_payment_created",
      "supplier_payment_posting_started",
      "supplier_payment_allocation_reserved",
      "supplier_payment_posted"
    ]);
    assert.equal(auditEvents[3].entityType, "SupplierPayment");
    assert.equal(auditEvents[3].actorId, "admin-1");
    assert.equal(auditEvents[3].requestId, "req-1");
    assert.equal(auditEvents[3].metadata.journalEntryId, "journal-1");
    assert.equal(JSON.stringify(auditEvents).includes("must-not-be-audit-payload"), false);
  } finally {
    if (previousFlag === undefined) delete process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED;
    else process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED = previousFlag;
    if (previousMode === undefined) delete process.env.EXPENSE_POSTING_MODE;
    else process.env.EXPENSE_POSTING_MODE = previousMode;
  }
});

test("supplier payment audit failure does not block financial posting", async () => {
  const previousFlag = process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED;
  const previousMode = process.env.EXPENSE_POSTING_MODE;
  process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED = "true";
  process.env.EXPENSE_POSTING_MODE = "AUTOMATIC_SUPPLIER_PAYMENT_POSTING";
  const payment = { _id: "payment-1", status: "DRAFT", allocations: paymentInput().allocations };
  let updateCalls = 0;
  const PaymentModel = {
    findOne: () => query(null),
    findOneAndUpdate: (filter) => {
      updateCalls += 1;
      if (updateCalls === 1) return payment;
      if (updateCalls === 2) return query({ ...payment, status: "POSTING", allocationsReservedAt: null });
      if (updateCalls === 3) return query({ ...payment, status: "POSTING", allocationsReservedAt: new Date() });
      if (updateCalls === 4) return query({ ...payment, status: "POSTED", journalEntryId: "journal-1" });
      return query({ ...payment, status: "POSTED", journalEntryId: "journal-1", allocationsAppliedAt: new Date() });
    },
    updateOne: async () => ({ matchedCount: 1 })
  };
  try {
    const result = await createSupplierPayment({
      input: paymentInput(),
      PaymentModel,
      ExpenseModel: {
        find: () => query([{ _id: "expense-1", baseCurrencyAmount: 100, supplierPaymentAllocations: [] }]),
        updateOne: async () => ({ matchedCount: 1 }),
        updateMany: async () => ({ matchedCount: 0 })
      },
      MappingModel: mappingModels(),
      AccountModel: accountModels(),
      JournalModel: { findOne: () => query(null) },
      LineModel: { find: () => query([]) },
      LedgerService: { postSupplierPayment: async () => ({ journal: { id: "journal-1" } }) },
      AuditLogModel: { create: async () => { throw new Error("audit store unavailable"); } }
    });

    assert.equal(result.action, "posted");
  } finally {
    if (previousFlag === undefined) delete process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED;
    else process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED = previousFlag;
    if (previousMode === undefined) delete process.env.EXPENSE_POSTING_MODE;
    else process.env.EXPENSE_POSTING_MODE = previousMode;
  }
});

test("supplier payment rejects booking-accounting expenses outside business AP", async () => {
  const PaymentModel = { findOne: () => query(null) };
  const ExpenseModel = {
    find: () => query([{ _id: "expense-1", accountingScope: "BOOKING_ACCOUNTING", status: "APPROVED", baseCurrencyAmount: 100, supplierPaymentAllocations: [] }])
  };

  await assert.rejects(
    () => createSupplierPayment({
      input: paymentInput(),
      PaymentModel,
      ExpenseModel,
      MappingModel: mappingModels(),
      AccountModel: accountModels()
    }),
    (error) => error.code === "SUPPLIER_PAYMENT_EXPENSE_SCOPE_INVALID"
  );
});