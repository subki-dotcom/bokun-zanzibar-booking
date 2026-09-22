process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://127.0.0.1:1/booking-expense-isolated-test";
process.env.JWT_SECRET = "booking-expense-test";
process.env.ACCOUNTING_BASE_CURRENCY = "USD";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createBookingAccountingService } = require("../src/services/bookingAccounting");

const payload = (overrides = {}) => ({
  bookingReference: "BK-1", category: "DIRECT_GUIDE_COST", description: "Guide service",
  amount: 20, currency: "USD", expenseDate: "2026-09-20", idempotencyKey: "request-1", ...overrides
});
const setup = () => {
  const rows = [];
  const audits = [];
  const updates = [];
  const expenses = {
    findOne: async (query) => rows.find((row) => Object.entries(query).every(([key, value]) => row[key] === value)) || null,
    create: async (values) => {
      if (rows.some((row) => row.idempotencyKey === values.idempotencyKey || row.expenseReference === values.expenseReference)) {
        throw Object.assign(new Error("duplicate"), { code: 11000 });
      }
      const row = { _id: `expense-${rows.length + 1}`, createdAt: new Date("2026-09-20T08:00:00Z"), ...values };
      rows.push(row);
      return row;
    },
    findById: async (id) => {
      const row = rows.find((item) => item._id === id);
      return row ? { ...row } : null;
    },
    findByIdAndUpdate: async (id, update) => {
      updates.push(update);
      return { ...Object.assign(rows.find((row) => row._id === id), update.$set) };
    }
  };
  const service = createBookingAccountingService({
    BookingModel: {
      findOne: async ({ bookingReference }) => ({ _id: `id-${bookingReference}`, bookingReference, currency: "USD" }),
      findById: async (id) => ({ _id: id, bookingReference: id.replace(/^id-/, ""), currency: "USD" })
    },
    BusinessExpenseModel: expenses,
    AuditLogModel: { create: async (row) => { audits.push(row); } }
  });
  return { service, rows, audits, updates };
};

test("Booking Expenses requires a stable key before creating anything", async () => {
  const { service, rows } = setup();
  await assert.rejects(service.createBookingExpense({ payload: payload({ idempotencyKey: undefined }) }), { code: "BOOKING_EXPENSE_IDEMPOTENCY_REQUIRED" });
  assert.equal(rows.length, 0);
});

test("Booking Expenses replays simultaneous identical creates without duplicate expenses or audits", async () => {
  const { service, rows, audits } = setup();
  const results = await Promise.all(Array.from({ length: 8 }, () => service.createBookingExpense({ payload: payload() })));
  assert.equal(rows.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(results.filter((result) => result.action === "created").length, 1);
  assert.ok(results.every((result) => result.expense.id === rows[0]._id));
});

test("Booking Expenses rejects key reuse with a changed amount or booking", async () => {
  const { service, rows } = setup();
  await service.createBookingExpense({ payload: payload() });
  for (const change of [{ amount: 30 }, { bookingReference: "BK-2" }, { description: "Other guide" }]) {
    await assert.rejects(service.createBookingExpense({ payload: payload(change) }), { code: "BOOKING_EXPENSE_IDEMPOTENCY_CONFLICT" });
  }
  assert.equal(rows.length, 1);
});

test("Booking Expenses rejects operating and unknown categories on create and update", async () => {
  const { service, rows } = setup();
  for (const category of ["OFFICE_RENT", "SALARIES", "OTHER_OPERATING_EXPENSE", "NOT_A_CATEGORY"]) {
    await assert.rejects(service.createBookingExpense({ payload: payload({ category }) }), { code: "BOOKING_EXPENSE_CATEGORY_INVALID" });
  }
  await service.createBookingExpense({ payload: payload() });
  await assert.rejects(service.updateBookingExpense({ expenseId: rows[0]._id, payload: { category: "OFFICE_RENT" } }), { code: "BOOKING_EXPENSE_CATEGORY_INVALID" });
  assert.equal(rows[0].category, "DIRECT_GUIDE_COST");
});

test("Booking Expenses requires explicit FX rate, date and provenance for foreign currency", async () => {
  const { service, rows } = setup();
  for (const fx of [{}, { exchangeRate: 0.0004 }, { exchangeRate: 0.0004, exchangeRateDate: "2026-09-20" }, { exchangeRate: 0.0004, exchangeRateDate: "2026-09-20", exchangeRateSource: "manual" }]) {
    await assert.rejects(service.createBookingExpense({ payload: payload({ currency: "TZS", ...fx }) }), { code: "BOOKING_EXPENSE_FX_EVIDENCE_REQUIRED" });
  }
  assert.equal(rows.length, 0);
});

test("Booking Expenses uses the accounting base and evidenced conversion without a 1:1 fallback", async () => {
  const { service, rows } = setup();
  await service.createBookingExpense({ payload: payload({ currency: "TZS", amount: 25000, exchangeRate: 0.0004, exchangeRateDate: "2026-09-20", exchangeRateSource: "Bank quote Q-123" }) });
  assert.equal(rows[0].baseCurrency, "USD");
  assert.equal(Number(rows[0].baseCurrencyAmount), 10);
  assert.equal(Number(rows[0].exchangeRate), 0.0004);
  await assert.rejects(service.createBookingExpense({ payload: payload({ idempotencyKey: "request-2", currency: "TZS", baseCurrency: "TZS" }) }), { code: "BOOKING_EXPENSE_BASE_CURRENCY_INVALID" });
});

test("Booking Expenses preserves identity conversion only for the accounting currency", async () => {
  const { service, rows } = setup();
  await service.createBookingExpense({ payload: payload() });
  assert.equal(Number(rows[0].exchangeRate), 1);
  assert.equal(rows[0].exchangeRateSource, "IDENTITY");
});

test("Booking Expenses rejects invalid FX and currency without writing records", async () => {
  const { service, rows } = setup();
  for (const change of [{ exchangeRate: 0 }, { exchangeRate: -1 }, { exchangeRate: Infinity }, { exchangeRateDate: "bad-date" }]) {
    await assert.rejects(service.createBookingExpense({ payload: payload({ currency: "EUR", exchangeRate: 1.1, exchangeRateDate: "2026-09-20", exchangeRateSource: "Bank quote Q-123", ...change }) }), { code: "BOOKING_EXPENSE_FX_EVIDENCE_REQUIRED" });
  }
  await assert.rejects(service.createBookingExpense({ payload: payload({ currency: "ZZZ" }) }), { code: "BOOKING_EXPENSE_CURRENCY_INVALID" });
  assert.equal(rows.length, 0);
});

test("Booking Expenses does not reuse the old FX evidence after a currency change", async () => {
  const { service, rows } = setup();
  await service.createBookingExpense({ payload: payload() });
  await assert.rejects(service.updateBookingExpense({ expenseId: rows[0]._id, payload: { currency: "EUR" } }), { code: "BOOKING_EXPENSE_FX_EVIDENCE_REQUIRED" });
  assert.equal(rows[0].currency, "USD");
});

test("Booking Expenses reports reference collisions without another create", async () => {
  const { service, rows } = setup();
  await service.createBookingExpense({ payload: payload({ expenseReference: "SUPPLIER-123" }) });
  await assert.rejects(service.createBookingExpense({ payload: payload({ expenseReference: "SUPPLIER-123", idempotencyKey: "different-request" }) }), { code: "BOOKING_EXPENSE_DUPLICATE_REFERENCE" });
  assert.equal(rows.length, 1);
});

test("Booking Expenses schema admits direct costs while preserving historical categories", () => {
  const Expense = require("../src/models/BusinessExpense");
  const category = Expense.schema.path("category").enumValues;
  assert.ok(category.includes("DIRECT_GUIDE_COST"));
  assert.ok(category.includes("OTHER_OPERATING_EXPENSE"));
  assert.ok(Expense.schema.indexes().some(([keys, options]) => keys.idempotencyKey === 1 && options.unique));
});

test("Booking Expenses cannot change identity to bypass replay protection", async () => {
  const { service, rows } = setup();
  await service.createBookingExpense({ payload: payload() });
  for (const change of [{ idempotencyKey: "new-key" }, { expenseReference: "new-reference" }]) {
    await assert.rejects(service.updateBookingExpense({ expenseId: rows[0]._id, payload: change }), { code: "BOOKING_EXPENSE_IDENTITY_IMMUTABLE" });
  }
  assert.equal((await service.createBookingExpense({ payload: payload() })).action, "unchanged");
  assert.equal(rows.length, 1);
});

test("Booking Expenses API validates category, date and stable key", () => {
  const { bookingExpenseWriteSchema } = require("../src/validators/bookingAccounting.validation");
  assert.equal(bookingExpenseWriteSchema.safeParse({ body: payload() }).success, true);
  for (const change of [{ category: "OFFICE_RENT" }, { category: "OTHER_OPERATING_EXPENSE" }, { idempotencyKey: " " }, { idempotencyKey: undefined }, { expenseDate: "" }, { expenseDate: "invalid" }]) {
    assert.equal(bookingExpenseWriteSchema.safeParse({ body: payload(change) }).success, false);
  }
});

test("Booking Expense editing preserves User A as creator and attributes User B through the existing audit log", async () => {
  const { service, rows, audits, updates } = setup();
  await service.createBookingExpense({ payload: payload(), auth: { id: "user-a", role: "admin" } });
  assert.equal(rows[0].createdBy, "user-a");
  const createdAt = rows[0].createdAt.toISOString();
  await service.updateBookingExpense({
    expenseId: rows[0]._id, payload: { description: "Corrected guide description" },
    auth: { id: "user-b", role: "admin" }, requestId: "edit-request-1"
  });
  assert.equal(rows[0].createdBy, "user-a");
  assert.equal(rows[0].createdAt.toISOString(), createdAt);
  assert.equal(Object.hasOwn(updates[0].$set, "createdBy"), false);
  assert.equal(Object.hasOwn(updates[0].$set, "createdAt"), false);
  const edit = audits.find((row) => row.action === "booking_expense_updated");
  assert.equal(edit.actorId, "user-b");
  assert.equal(edit.entityId, rows[0]._id);
  assert.equal(edit.requestId, "edit-request-1");
  assert.equal(edit.before.description, "Guide service");
  assert.equal(edit.after.description, "Corrected guide description");
  assert.equal(audits.length, 2);
});

test("Booking Expense update ignores attempted creator/timestamp replacement", async () => {
  const { service, rows } = setup();
  await service.createBookingExpense({ payload: payload(), auth: { id: "user-a" } });
  const createdAt = rows[0].createdAt.toISOString();
  await service.updateBookingExpense({ expenseId: rows[0]._id, payload: { createdBy: "forged-creator", createdAt: "2099-01-01" } });
  assert.equal(rows[0].createdBy, "user-a");
  assert.equal(rows[0].createdAt.toISOString(), createdAt);
});
