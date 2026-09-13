require("dotenv").config();
const fs = require("fs");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const Booking = require("../src/models/Booking");
const Invoice = require("../src/models/Invoice");
const { mapBokunBookingForImport } = require("../src/integrations/bokun/confirmedBooking.mapper");

const args = process.argv.slice(2);
const valueOf = (name, fallback = "") => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const decimal = (value) => value == null ? null : Number(value?.toString?.() ?? value);
const addTotal = (totals, currency, amount) => {
  const key = currency || "UNKNOWN";
  if (!totals[key]) totals[key] = { count: 0, amount: 0 };
  totals[key].count += 1;
  if (Number.isFinite(amount)) totals[key].amount += amount;
};

async function main() {
  if (args.includes("--apply")) throw new Error("This tool is audit/dry-run only; reviewed repair apply is intentionally unavailable.");
  const mode = args.includes("--dry-run") ? "dry-run" : "audit";
  const limit = Math.max(1, Math.min(1000, Number(valueOf("--limit", "500"))));
  const query = { $or: [{ bokunBookingId: { $type: "string", $ne: "" } }, { operationalSource: "BOKUN" }] };
  if (valueOf("--reference")) query.bookingReference = valueOf("--reference");
  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const bookings = await Booking.find(query).sort({ _id: 1 }).limit(limit).lean();
  const invoices = await Invoice.find({ bookingReference: { $in: bookings.map((row) => row.bookingReference) } })
    .select("bookingReference invoiceNumber total totalAmount currency transactionCurrency accountingCurrency").lean();
  const invoiceByReference = new Map(invoices.map((row) => [row.bookingReference, row]));
  const totals = { storedBooking: {}, bokun: {}, invoice: {}, mismatchTypes: {} };
  const rows = bookings.map((booking) => {
    const mapped = mapBokunBookingForImport({ bokunBooking: booking.rawBokunResponse || {} });
    const bokunAmount = mapped.snapshot.amount;
    const bokunCurrency = mapped.snapshot.currency || null;
    const storedCurrency = booking.transactionCurrency || booking.currency || null;
    const storedAmount = decimal(booking.amount ?? booking.pricingSnapshot?.finalPayable);
    const invoice = invoiceByReference.get(booking.bookingReference);
    const invoiceCurrency = invoice?.transactionCurrency || invoice?.currency || invoice?.accountingCurrency || null;
    const invoiceAmount = decimal(invoice?.totalAmount ?? invoice?.total);
    const mismatchTypes = [];
    if (!bokunCurrency) mismatchTypes.push("MISSING_BOKUN_CURRENCY");
    if (!storedCurrency) mismatchTypes.push("MISSING_BOOKING_CURRENCY");
    if (bokunCurrency && storedCurrency && bokunCurrency !== storedCurrency) mismatchTypes.push("BOOKING_CURRENCY_MISMATCH");
    if (bokunCurrency && invoiceCurrency && bokunCurrency !== invoiceCurrency) mismatchTypes.push("INVOICE_CURRENCY_MISMATCH");
    if (bokunCurrency && storedCurrency === bokunCurrency && invoiceCurrency === bokunCurrency) mismatchTypes.push("MATCH");
    for (const type of mismatchTypes) totals.mismatchTypes[type] = (totals.mismatchTypes[type] || 0) + 1;
    addTotal(totals.storedBooking, storedCurrency, storedAmount);
    addTotal(totals.bokun, bokunCurrency, bokunAmount);
    if (invoice) addTotal(totals.invoice, invoiceCurrency, invoiceAmount);
    return {
      bookingId: String(booking._id), bookingReference: booking.bookingReference,
      bokunBookingId: booking.bokunBookingId || null, channel: booking.salesChannel || null,
      storedAmount, storedCurrency, bokunAmount, bokunCurrency,
      bokunCurrencySource: mapped.snapshot.bokunCurrencySource,
      invoiceNumber: invoice?.invoiceNumber || null, invoiceAmount, invoiceCurrency,
      mismatchTypes,
      ...(mode === "dry-run" ? {
        proposedRepair: mismatchTypes.includes("MISSING_BOKUN_CURRENCY") ? null : {
          booking: { currency: bokunCurrency, transactionCurrency: bokunCurrency,
            pricingSnapshotCurrency: bokunCurrency, source: mapped.snapshot.bokunCurrencySource },
          invoice: invoice ? { transactionCurrency: bokunCurrency } : null,
          guarded: true,
          untouched: ["payments", "refunds", "journals", "generalLedger", "settlements", "exchangeRates"]
        }
      } : {})
    };
  });
  const report = { mode, generatedAt: new Date().toISOString(), readOnly: true,
    totalMatching: await Booking.countDocuments(query), scanned: rows.length,
    mismatchCount: rows.filter((row) => row.mismatchTypes.some((type) => type !== "MATCH")).length,
    totals, rows };
  const output = valueOf("--output");
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode, scanned: report.scanned, mismatchCount: report.mismatchCount,
    mismatchTypes: totals.mismatchTypes, output: output || null }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
