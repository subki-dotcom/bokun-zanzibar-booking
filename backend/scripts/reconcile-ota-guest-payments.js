require("dotenv").config();
const fs = require("fs");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const Booking = require("../src/models/Booking");
const Invoice = require("../src/models/Invoice");
const Payment = require("../src/models/Payment");
const bookingsService = require("../src/services/bookings");
const { resolveGuestPaymentPolicy } = require("../src/services/bookingPayment/policy");

const args = process.argv.slice(2);
const valueOf = (name, fallback = "") => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const limit = Math.max(1, Math.min(1000, Number(valueOf("--limit", "100"))));
const apply = args.includes("--apply");
const reviewPath = valueOf("--review");

async function main() {
  if (apply && !reviewPath) throw new Error("--apply requires --review <dry-run-report> after human review.");
  const reviewed = apply ? JSON.parse(fs.readFileSync(reviewPath, "utf8")) : null;
  if (apply && reviewed.mode !== "dry-run") throw new Error("Review file must be a dry-run report.");
  const approved = new Set((reviewed?.rows || []).filter((row) => row.action === "reconcile").map((row) => row.bookingId));
  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const bookings = await Booking.find({ bookingStatus: "confirmed" }).sort({ _id: 1 }).limit(limit).lean();
  const references = bookings.map((booking) => booking.bookingReference);
  const [invoices, payments] = await Promise.all([
    Invoice.find({ bookingReference: { $in: references } }).lean(),
    Payment.find({ bookingReference: { $in: references }, verificationStatus: "verified" }).lean()
  ]);
  const invoicesByReference = new Map(invoices.map((invoice) => [invoice.bookingReference, invoice]));
  const paymentsByReference = payments.reduce((map, payment) => {
    const items = map.get(payment.bookingReference) || [];
    items.push(payment); map.set(payment.bookingReference, items); return map;
  }, new Map());
  const rows = [];
  for (const booking of bookings) {
    const total = Number(booking.pricingSnapshot?.finalPayable ?? booking.amount ?? 0);
    const localPayments = paymentsByReference.get(booking.bookingReference) || [];
    const policy = resolveGuestPaymentPolicy({ booking, total, verifiedPaidAmount: localPayments.reduce((sum, payment) => sum + Number(payment.accountingAmount || payment.amountPaid || payment.paidAmount || 0), 0) });
    const invoice = invoicesByReference.get(booking.bookingReference);
    const needsReconcile = policy.autoReconciled && invoice && (Number(invoice.amountPaid || 0) + 0.009 < total || Number(invoice.balanceDue || 0) > 0.009);
    const row = { bookingId: String(booking._id), bookingReference: booking.bookingReference, channel: policy.channel, collector: policy.collector, invoiceNumber: invoice?.invoiceNumber || null, total, localVerifiedPaymentCount: localPayments.length, action: needsReconcile && !localPayments.length ? "reconcile" : "skip", reason: !invoice ? "missing_invoice" : localPayments.length ? "local_payment_requires_review" : needsReconcile ? "ota_guest_prepayment" : "already_reconciled" };
    if (apply && approved.has(row.bookingId) && row.action === "reconcile") {
      await bookingsService.syncInvoiceForBookingReference({ bookingId: row.bookingId, auth: { id: null, role: "system" }, requestId: `reviewed_ota_guest_payment_${row.bookingId}`, reason: "Reviewed OTA guest-payment reconciliation" });
      row.applied = true;
    }
    rows.push(row);
  }
  const report = { mode: apply ? "apply" : "dry-run", generatedAt: new Date().toISOString(), examined: rows.length, proposed: rows.filter((row) => row.action === "reconcile").length, changed: rows.filter((row) => row.applied).length, skipped: rows.filter((row) => row.action === "skip").length, requiresReview: rows.filter((row) => row.reason === "local_payment_requires_review").length, rows };
  const output = valueOf("--output");
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode: report.mode, examined: report.examined, proposed: report.proposed, changed: report.changed, skipped: report.skipped, requiresReview: report.requiresReview, output: output || null }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());