import test from "node:test";
import assert from "node:assert/strict";
import { amountCell, companyLines, docDate, docDateTime, mobileItemLine, money, paymentMethodLine, tripWhen } from "../src/components/invoice/doc/invoiceFormat.js";

test("money and dates read as in the mockup, in Zanzibar time", () => {
  assert.equal(money(45, "USD"), "$45.00");
  assert.equal(docDate("2026-10-27T07:00:00.000Z"), "27 Oct 2026");
  // 22:30 UTC is already the next day in Zanzibar.
  assert.equal(docDate("2026-10-26T22:30:00.000Z"), "27 Oct 2026");
  assert.equal(docDateTime("2026-10-27T07:14:00.000Z"), "27 Oct 2026, 10:14 (Zanzibar time)");
  assert.equal(tripWhen({ date: "2026-11-30", startTime: "09:00" }), "Mon, 30 Nov 2026 · 09:00 (Zanzibar time)");
});

test("the last meta cell shows what is paid or still due", () => {
  assert.deepEqual(amountCell({ kind: "invoice", balanceDue: 0, amountPaid: 45, currency: "USD" }), { label: "Amount paid", value: "$45.00 USD" });
  assert.deepEqual(amountCell({ kind: "invoice", balanceDue: 20, amountPaid: 25, currency: "USD" }), { label: "Amount due", value: "$20.00 USD", due: true });
  assert.equal(amountCell({ kind: "credit_note", total: 45, currency: "USD" }).label, "Amount credited");
});

test("only the card brand and last 4 digits are shown", () => {
  assert.equal(paymentMethodLine({ method: "Card via Pesapal", brand: "Visa", last4: "1234" }), "Card via Pesapal · Visa •••• 1234");
  assert.equal(paymentMethodLine({ method: "M-Pesa via Pesapal", brand: "", last4: "" }), "M-Pesa via Pesapal");
});

test("phone item line and company lines", () => {
  const doc = { trip: { date: "2026-11-30", startTime: "09:00" } };
  assert.equal(mobileItemLine(doc, { qty: 1, subDescription: "Nungwi hotel to Nungwi hotels · Adult" }), "30 Nov 2026 · 09:00 · 1 × Adult");
  assert.deepEqual(companyLines({ phone: "+255 778 775 044", email: "info@x.tz", tin: "123" }), ["+255 778 775 044 · info@x.tz", "TIN: 123"]);
});
