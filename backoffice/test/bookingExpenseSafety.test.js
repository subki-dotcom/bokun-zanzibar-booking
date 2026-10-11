import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { newBookingExpenseForm, bookingExpensePayload } from "../src/pages/admin/bookingExpenseForm.js";

test("expense form retains its submission key across retries and rotates after a new expense", () => {
  const form = newBookingExpenseForm("BK-1");
  form.amount = "25";
  assert.ok(form.idempotencyKey);
  assert.deepEqual(bookingExpensePayload(form, "USD"), bookingExpensePayload(form, "USD"));
  assert.equal(bookingExpensePayload(form, "USD").idempotencyKey, form.idempotencyKey);
  assert.notEqual(newBookingExpenseForm().idempotencyKey, form.idempotencyKey);
  assert.equal(form.category, "DIRECT_SUPPLIER_COST");
  assert.match(form.expenseDate, /^\d{4}-\d{2}-\d{2}$/);
});

test("expense form sends explicit FX evidence only when required", () => {
  const form = { ...newBookingExpenseForm(), currency: "TZS", amount: "25000", exchangeRate: "0.0004", exchangeRateDate: "2026-09-20", exchangeRateSource: " Bank quote Q-123 " };
  const foreign = bookingExpensePayload(form, "USD");
  assert.equal(foreign.baseCurrency, "USD");
  assert.equal(foreign.exchangeRate, 0.0004);
  assert.equal(foreign.exchangeRateSource, "Bank quote Q-123");
  const local = bookingExpensePayload({ ...form, currency: "USD" }, "USD");
  assert.equal("exchangeRate" in local, false);
  assert.equal("exchangeRateSource" in local, false);
});

test("expense form wires controlled categories, FX evidence and a synchronous duplicate-submit guard", () => {
  const source = fs.readFileSync(new URL("../src/pages/admin/AdminBookingAccountingPage.jsx", import.meta.url), "utf8");
  const form = source.slice(source.indexOf("const BookingExpenseForm"), source.indexOf("const ProfitabilityTable"));
  assert.ok(form.includes("expenseConfig?.directCostCategories"));
  assert.ok(form.includes("inFlight.current = true"));
  assert.ok(form.includes("bookingExpensePayload(form, expenseConfig.baseCurrency)"));
  assert.ok(form.includes("Rate source / evidence reference"));
  assert.equal(form.includes("OTHER_OPERATING_EXPENSE"), false);
  assert.equal(form.includes('expenseDate: ""'), false);
});
