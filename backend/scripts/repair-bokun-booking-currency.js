require("dotenv").config();
const fs = require("fs");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const Booking = require("../src/models/Booking");
const Invoice = require("../src/models/Invoice");
const Payment = require("../src/models/Payment");
const Refund = require("../src/models/Refund");
const JournalEntry = require("../src/models/JournalEntry");
const AuditLog = require("../src/models/AuditLog");
const { mapBokunBookingForImport } = require("../src/integrations/bokun/confirmedBooking.mapper");

const args = process.argv.slice(2);
const valueOf = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : "";
const decimal = (value) => value == null ? null : Number(value?.toString?.() ?? value);

async function main() {
  const reviewPath = valueOf("--review");
  const outputPath = valueOf("--output");
  if (!args.includes("--apply") || !reviewPath) throw new Error("Use --apply --review <dry-run-report> after explicit approval.");
  const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
  if (review.mode !== "dry-run" || review.readOnly !== true) throw new Error("Review file is not a currency repair dry run.");
  const candidates = review.rows.filter((row) => row.proposedRepair &&
    (row.mismatchTypes.includes("BOOKING_CURRENCY_MISMATCH") || row.mismatchTypes.includes("INVOICE_CURRENCY_MISMATCH")));
  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const prepared = [];
  for (const reviewed of candidates) {
    const booking = await Booking.findById(reviewed.bookingId);
    if (!booking || booking.bookingReference !== reviewed.bookingReference) throw new Error(`Booking changed or missing: ${reviewed.bookingReference}`);
    const invoice = await Invoice.findOne({ bookingReference: booking.bookingReference });
    const mapped = mapBokunBookingForImport({ bokunBooking: booking.rawBokunResponse || {} });
    const currency = mapped.snapshot.currency;
    if (!currency || currency !== reviewed.bokunCurrency || decimal(mapped.snapshot.amount) !== decimal(reviewed.bokunAmount)) {
      throw new Error(`Bókun evidence changed: ${booking.bookingReference}`);
    }
    const currentCurrency = booking.transactionCurrency || booking.currency || null;
    const invoiceCurrency = invoice?.transactionCurrency || invoice?.currency || invoice?.accountingCurrency || null;
    if (currentCurrency !== reviewed.storedCurrency || decimal(booking.amount) !== decimal(reviewed.storedAmount) ||
        invoiceCurrency !== reviewed.invoiceCurrency || decimal(invoice?.totalAmount ?? invoice?.total) !== decimal(reviewed.invoiceAmount)) {
      throw new Error(`Local booking or invoice changed after review: ${booking.bookingReference}`);
    }
    const [payments, refunds, journals] = await Promise.all([
      Payment.countDocuments({ bookingReference: booking.bookingReference }),
      Refund.countDocuments({ bookingReference: booking.bookingReference }),
      JournalEntry.countDocuments({ bookingReference: booking.bookingReference })
    ]);
    if (payments || refunds || journals) throw new Error(`Financial evidence blocks automatic repair: ${booking.bookingReference}`);
    prepared.push({ booking, invoice, mapped, before: {
      bookingCurrency: booking.currency, transactionCurrency: booking.transactionCurrency || "",
      pricingCurrency: booking.pricingSnapshot?.currency || "", invoiceCurrency,
      invoiceAccountingCurrency: invoice?.accountingCurrency || ""
    } });
  }

  const applied = [];
  for (const row of prepared) {
    const currency = row.mapped.snapshot.currency;
    const eventId = crypto.randomUUID();
    row.booking.currency = currency;
    row.booking.transactionCurrency = currency;
    row.booking.bokunCurrencySource = row.mapped.snapshot.bokunCurrencySource;
    if (row.booking.pricingSnapshot) row.booking.pricingSnapshot.currency = currency;
    if (row.booking.invoiceSnapshot) {
      row.booking.invoiceSnapshot.transactionCurrency = currency;
      row.booking.invoiceSnapshot.accountingCurrency = currency;
      row.booking.markModified("invoiceSnapshot");
    }
    await row.booking.save();
    if (row.invoice) {
      row.invoice.transactionCurrency = currency;
      row.invoice.accountingCurrency = currency;
      await row.invoice.save();
    }
    await AuditLog.create({ actorId: null, actorRole: "system", action: "bokun_booking_currency_repaired",
      entityType: "Booking", entityId: String(row.booking._id), reference: row.booking.bookingReference,
      reason: "Reviewed Bókun customer-invoice transaction currency repair", before: row.before,
      after: { bookingCurrency: currency, transactionCurrency: currency, pricingCurrency: currency,
        invoiceCurrency: row.invoice ? currency : null, amountsChanged: false },
      metadata: { bookingCurrencyEventId: eventId, source: row.mapped.snapshot.bokunCurrencySource,
        reviewReport: reviewPath, untouched: ["payments", "refunds", "journals", "generalLedger", "settlements", "exchangeRates"] } });
    applied.push({ bookingId: String(row.booking._id), bookingReference: row.booking.bookingReference,
      invoiceNumber: row.invoice?.invoiceNumber || null, before: row.before, currency, amountsChanged: false, eventId });
  }
  const result = { mode: "apply", appliedAt: new Date().toISOString(), reviewed: candidates.length,
    applied: applied.length, financialAmountsChanged: false, rows: applied };
  if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ reviewed: candidates.length, applied: applied.length, output: outputPath || null }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
