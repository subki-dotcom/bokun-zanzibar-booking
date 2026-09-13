process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/bokun-currency-test";
process.env.JWT_SECRET ||= "bokun-currency-test-secret";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mapBokunBookingForImport } = require("../src/integrations/bokun/confirmedBooking.mapper");
const invoices = require("../src/services/invoices");
const Invoice = require("../src/models/Invoice");
const Refund = require("../src/models/Refund");
const payments = require("../src/services/payments");
const { __testables: webhookTestables } = require("../src/services/webhooks");

const payload = ({ currency, rootCurrency = currency, channel = "Viator" }) => ({ booking: {
  id: `B-${currency || "NONE"}`, bookingId: `B-${currency || "NONE"}`, confirmationCode: `C-${currency || "NONE"}`,
  externalBookingReference: `R-${currency || "NONE"}`, status: "CONFIRMED", totalPrice: 70,
  ...(rootCurrency ? { currency: rootCurrency } : {}), channel: { title: channel },
  ...(currency ? { invoice: { currency, totalAsMoney: { amount: 70, currency } } } : {}),
  activityBookings: [{ productId: "P1", rateId: "O1", title: "Tour", rateTitle: "Option",
    date: "2026-09-13", pricingCategoryBookings: [] }]
} });

test("customer invoice Money object keeps USD 70 even when Bókun root seller currency is EUR", () => {
  const mapped = mapBokunBookingForImport({ bokunBooking: payload({ currency: "USD", rootCurrency: "EUR", channel: "GetYourGuide" }) });
  assert.equal(mapped.snapshot.amount, 70);
  assert.equal(mapped.snapshot.currency, "USD");
  assert.equal(mapped.snapshot.transactionCurrency, "USD");
  assert.equal(mapped.snapshot.pricingSnapshot.currency, "USD");
  assert.equal(mapped.snapshot.bokunCurrencySource, "BOKUN_CUSTOMER_INVOICE_MONEY");
});

test("EUR and TZS transaction currencies are preserved without channel inference", () => {
  for (const currency of ["EUR", "TZS"]) {
    for (const channel of ["GetYourGuide", "Viator", "Direct", "Unknown channel"]) {
      const mapped = mapBokunBookingForImport({ bokunBooking: payload({ currency, channel }) });
      assert.equal(mapped.snapshot.currency, currency);
      assert.equal(mapped.snapshot.amount, 70);
    }
  }
});

test("missing Bókun currency is rejected for review instead of defaulting to USD", () => {
  const mapped = mapBokunBookingForImport({ bokunBooking: payload({ currency: "", rootCurrency: "" }) });
  assert.equal(mapped.snapshot.currency, "");
  assert.equal(mapped.snapshot.bokunCurrencySource, "MISSING_BOKUN_CURRENCY");
  assert.equal(mapped.validationErrors.includes("currency"), true);
  assert.equal(mapped.isImportableConfirmed, false);
});

test("invoice snapshot inherits booking transaction currency", async () => {
  const originals = { findOne: Invoice.findOne, countDocuments: Invoice.countDocuments,
    aggregate: Refund.aggregate, summary: payments.getVerifiedAccountingSummary };
  Invoice.findOne = () => ({ select: () => ({ lean: async () => null }) });
  Invoice.countDocuments = async () => 0;
  Refund.aggregate = async () => [];
  payments.getVerifiedAccountingSummary = async ({ fallbackCurrency }) => ({ amount: 0, currency: fallbackCurrency });
  try {
    for (const currency of ["USD", "EUR", "TZS"]) {
      const snapshot = await invoices.buildInvoiceSnapshot({ booking: {
        bookingReference: `INV-${currency}`, transactionCurrency: currency, currency: "EUR",
        pricingSnapshot: { currency, grossAmount: 70, discountAmount: 0,
          lineItems: [{ label: "Tour", quantity: 1, unitPrice: 70, total: 70 }] },
        bookingStatus: "confirmed", paymentStatus: "pending", customer: {}, paxSummary: {}
      }, productSnapshot: {} });
      assert.equal(snapshot.total, 70);
      assert.equal(snapshot.transactionCurrency, currency);
      assert.equal(snapshot.accountingCurrency, currency);
    }
  } finally {
    Invoice.findOne = originals.findOne; Invoice.countDocuments = originals.countDocuments;
    Refund.aggregate = originals.aggregate; payments.getVerifiedAccountingSummary = originals.summary;
  }
});

test("webhook mapping preserves authoritative currency and never guesses missing evidence", () => {
  const booking = { amount: 70, currency: "EUR", transactionCurrency: "EUR",
    bokunCurrencySource: "BOKUN_ROOT_CURRENCY", pricingSnapshot: { currency: "EUR" } };
  const mapped = mapBokunBookingForImport({ bokunBooking: payload({ currency: "USD", rootCurrency: "EUR" }) });
  assert.equal(webhookTestables.applyMappedTransactionCurrency({ bookingDoc: booking, mappedBooking: mapped }), true);
  assert.equal(booking.currency, "USD");
  assert.equal(booking.transactionCurrency, "USD");
  assert.equal(booking.pricingSnapshot.currency, "USD");
  const missing = mapBokunBookingForImport({ bokunBooking: payload({ currency: "", rootCurrency: "" }) });
  assert.equal(webhookTestables.applyMappedTransactionCurrency({ bookingDoc: booking, mappedBooking: missing }), false);
  assert.equal(booking.currency, "USD");
});
