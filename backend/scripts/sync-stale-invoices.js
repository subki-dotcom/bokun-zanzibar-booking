// Finds invoices that no longer match their booking: for example a Bókun amendment cancelled a booking and Bókun then
// confirmed it again, but the invoice still says "cancelled / not paid". For every booking that has an invoice, the
// invoice is rebuilt in memory with the normal invoice rules and compared with the stored one.
// Without --apply it only reads and lists the differences. With --apply each listed invoice is rebuilt exactly like
// the admin "Sync invoice" action (services/bookings syncInvoiceForBookingReference); nothing else is changed, no
// email is sent and nothing is posted to the ledger.
// Usage (PowerShell, from the backend folder):
//   $env:REPORT_MONGO_URI = "<Atlas connection string>"
//   node scripts/sync-stale-invoices.js                          # dry run: lists invoices that are out of date
//   node scripts/sync-stale-invoices.js --apply                  # rebuilds every listed invoice
//   node scripts/sync-stale-invoices.js --apply --only=GYGFWVZFLQX5,GYG48YB5XRFY
if (process.env.REPORT_MONGO_URI) process.env.MONGO_URI = process.env.REPORT_MONGO_URI;
require("dotenv").config();

const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const Booking = require("../src/models/Booking");
const Invoice = require("../src/models/Invoice");
const ProductSnapshot = require("../src/models/ProductSnapshot");
const invoicesService = require("../src/services/invoices");
const bookingsService = require("../src/services/bookings");

const apply = process.argv.includes("--apply");
const only = new Set(
  (process.argv.find((arg) => arg.startsWith("--only=")) || "--only=")
    .slice("--only=".length)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

const text = (value) => String(value ?? "").trim().toLowerCase();
// A missing amount on an older invoice means 0 (refunds were not recorded on invoices at first).
const cents = (value) => (value == null || value === "" ? 0 : Math.round(Number(String(value)) * 100));

// What the invoice shows; any difference here means the stored invoice is out of date.
const FIELDS = [
  ["bookingStatus", (inv) => text(inv.bookingStatus)],
  ["paymentStatus", (inv) => text(inv.paymentStatus)],
  ["currency", (inv) => text(inv.currency)],
  ["total", (inv) => cents(inv.totalAmount ?? inv.total)],
  ["amountPaid", (inv) => cents(inv.paidAccountingAmount ?? inv.amountPaid)],
  ["amountRefunded", (inv) => cents(inv.refundedAccountingAmount ?? inv.amountRefunded)],
  ["balanceDue", (inv) => cents(inv.balanceDueAmount ?? inv.balanceDue)]
];
const show = (field, value) => (["total", "amountPaid", "amountRefunded", "balanceDue"].includes(field) ? (value / 100).toFixed(2) : value || "—");

const differences = (stored, fresh) =>
  FIELDS.map(([field, read]) => [field, read(stored), read(fresh)])
    .filter(([, before, after]) => before !== after)
    .map(([field, before, after]) => `${field} ${show(field, before)} → ${show(field, after)}`);

const findStale = async () => {
  const invoices = await Invoice.find(only.size ? { bookingReference: { $in: [...only] } } : {}).lean();
  const stale = [];
  const unchecked = [];
  for (const invoice of invoices) {
    const booking = await Booking.findOne({ bookingReference: invoice.bookingReference }).lean();
    if (!booking) {
      unchecked.push({ invoice, reason: "booking not found" });
      continue;
    }
    try {
      const productSnapshot = await ProductSnapshot.findOne({ bokunProductId: booking.bokunProductId }).lean();
      // Reads only: the invoice already exists, so no new invoice number is taken.
      const fresh = await invoicesService.buildInvoiceSnapshot({ booking, productSnapshot });
      const diff = differences(invoice, fresh);
      if (diff.length) stale.push({ invoice, booking, diff });
    } catch (error) {
      unchecked.push({ invoice, reason: error.message });
    }
  }
  return { checked: invoices.length, stale, unchecked };
};

const report = ({ checked, stale, unchecked }, heading) => {
  console.log(`\n${heading}: ${checked} invoice(s) checked, ${stale.length} out of date, ${unchecked.length} could not be checked.`);
  for (const { invoice, booking, diff } of stale) {
    console.log(`  ${invoice.invoiceNumber}  ${invoice.bookingReference}  (${booking.salesChannel || booking.sourceChannel || "?"}, booking ${booking.bookingStatus})`);
    console.log(`      ${diff.join("; ")}`);
  }
  for (const { invoice, reason } of unchecked) console.log(`  could not check ${invoice.invoiceNumber} ${invoice.bookingReference}: ${reason}`);
};

(async () => {
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 20000, autoIndex: false, autoCreate: false });
  const before = await findStale();
  report(before, "Before");

  if (!apply) {
    console.log("\nDry run: nothing changed. Add --apply to rebuild the invoices listed above.");
  } else if (!before.stale.length) {
    console.log("\nNothing to rebuild.");
  } else {
    let rebuilt = 0;
    for (const { invoice } of before.stale) {
      try {
        await bookingsService.syncInvoiceForBookingReference({
          bookingReference: invoice.bookingReference,
          auth: { id: null, role: "script" },
          requestId: `sync_stale_invoices_${Date.now()}`,
          reason: "Script: rebuilt an invoice that no longer matched its booking"
        });
        rebuilt += 1;
        console.log(`  rebuilt ${invoice.invoiceNumber} (${invoice.bookingReference})`);
      } catch (error) {
        console.log(`  FAILED ${invoice.invoiceNumber} (${invoice.bookingReference}): ${error.message}`);
      }
    }
    console.log(`\nRebuilt ${rebuilt} of ${before.stale.length}.`);
    report(await findStale(), "After");
  }
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Invoice check failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
