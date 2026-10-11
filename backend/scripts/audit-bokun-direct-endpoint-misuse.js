/*
 * READ-ONLY review of possible misuse of the formerly unauthenticated endpoints
 *   POST /api/bokun/bookings, GET /api/bokun/bookings/:reference,
 *   POST /api/bokun/bookings/:bookingId/cancel, POST /api/bokun/bookings/:bookingId/edit
 *
 * It only runs find/aggregate queries through the native driver (no models are loaded, so no index
 * builds or hooks run) and never writes. Findings are leads for a human to check in the Bokun
 * dashboard, not proof of misuse: a cancellation or amendment made by staff directly in Bokun looks the
 * same, and a booking created through the endpoint is only visible here once the import job pulled it in.
 *
 * Usage:
 *   MONGO_URI=<database> node scripts/audit-bokun-direct-endpoint-misuse.js [--since 2026-07-06] [--limit 200] [--json]
 */
require("dotenv").config();
const mongoose = require("mongoose");

const args = process.argv.slice(2);
const arg = (name, fallback = "") => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

// The endpoints were added on 2026-07-06 (commit 8c52a0a).
const ENDPOINTS_INTRODUCED_AT = "2026-07-06";

// Payment evidence that the normal checkout or a recorded manual receipt would leave behind.
const SETTLED_PAYMENT_STATUSES = ["paid", "partial", "overpaid", "partially_refunded", "refunded"];
// Actions written when a cancellation or change is initiated inside the application.
const APP_CANCEL_ACTIONS = [
  "booking_cancelled",
  "booking_cancel_requested",
  "booking_request_cancelled_by_customer",
  "booking_request_approved",
  "booking_request_completed"
];
const APP_CHANGE_ACTIONS = [
  "booking_edit_requested",
  "booking_request_approved",
  "booking_request_completed",
  "booking_request_supplier_change_confirmed",
  "confirm_supplier_change"
];

const redactUri = (uri) => String(uri || "").replace(/\/\/[^@/]*@/, "//***@").replace(/\?.*$/, "");

const pickBooking = (booking) => ({
  bookingReference: booking.bookingReference,
  bokunBookingId: booking.bokunBookingId || "",
  bokunConfirmationCode: booking.bokunConfirmationCode || "",
  operationalSource: booking.operationalSource || "",
  salesChannel: booking.salesChannel || "",
  rawChannelSource: booking.rawChannelSource || "",
  bookingStatus: booking.bookingStatus || "",
  bokunStatus: booking.bokunStatus?.normalized || "",
  paymentStatus: booking.paymentStatus || "",
  bokunPaymentStatus: booking.bookingPaymentStatus || "",
  amount: booking.amount,
  currency: booking.currency,
  createdAt: booking.createdAt,
  bokunCreatedAt: booking.bokunOperationalDates?.bookingCreatedAtBokun?.raw || ""
});

const main = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is required.");
  const since = new Date(arg("--since", ENDPOINTS_INTRODUCED_AT));
  if (Number.isNaN(since.getTime())) throw new Error("--since must be a date, e.g. 2026-07-06");
  const limit = Math.max(1, Math.min(5000, Number(arg("--limit", "200")) || 200));
  const asJson = args.includes("--json");

  await mongoose.connect(uri, { autoIndex: false, autoCreate: false, readPreference: "secondaryPreferred" });
  const db = mongoose.connection.db;
  const bookings = db.collection("bookings");
  const payments = db.collection("payments");
  const auditLogs = db.collection("auditlogs");

  const supplierBooking = { bokunBookingId: { $type: "string", $ne: "" } };
  const touchedSince = { $or: [{ createdAt: { $gte: since } }, { updatedAt: { $gte: since } }] };

  const paidReferences = async (references) => {
    if (!references.length) return new Set();
    const rows = await payments
      .find(
        {
          bookingReference: { $in: references },
          $or: [{ paymentStatus: { $in: SETTLED_PAYMENT_STATUSES } }, { verificationStatus: "verified" }]
        },
        { projection: { bookingReference: 1 } }
      )
      .toArray();
    return new Set(rows.map((row) => row.bookingReference));
  };

  const auditedBookings = async (list, actions) => {
    if (!list.length) return new Set();
    const ids = list.map((booking) => String(booking._id));
    const references = list.map((booking) => booking.bookingReference);
    const rows = await auditLogs
      .find(
        {
          action: { $in: actions },
          $or: [
            { entityType: "Booking", entityId: { $in: ids } },
            { "metadata.bookingId": { $in: ids } },
            { "metadata.bookingReference": { $in: references } },
            { reference: { $in: references } }
          ]
        },
        { projection: { entityId: 1, reference: 1, metadata: 1 } }
      )
      .toArray();
    const seen = new Set();
    for (const row of rows) {
      [row.entityId, row.reference, row.metadata?.bookingId, row.metadata?.bookingReference].filter(Boolean).forEach((key) => seen.add(String(key)));
    }
    return seen;
  };
  const hasAudit = (seen, booking) => seen.has(String(booking._id)) || seen.has(booking.bookingReference);

  // 1. Supplier bookings sold through our own website/API channel with no settled payment. OTA and agent
  //    channels are excluded because they are paid outside our checkout.
  const unpaid = await bookings
    .find({
      ...supplierBooking,
      ...touchedSince,
      salesChannel: "DIRECT_WEBSITE",
      paymentStatus: { $nin: SETTLED_PAYMENT_STATUSES }
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  const paid = await paidReferences(unpaid.map((booking) => booking.bookingReference));
  const unpaidFindings = unpaid
    .filter((booking) => !paid.has(booking.bookingReference) && booking.bookingPaymentStatus !== "PAID")
    .map((booking) => ({
      ...pickBooking(booking),
      // Imported bookings never went through our checkout, so they are the strongest lead.
      severity: booking.operationalSource === "BOKUN" ? "HIGH" : "MEDIUM"
    }));

  // 2. Cancelled supplier bookings with no cancellation started inside the application.
  const cancelled = await bookings
    .find({
      ...supplierBooking,
      $and: [
        touchedSince,
        { $or: [{ bookingStatus: "cancelled" }, { "bokunStatus.normalized": "cancelled" }] }
      ]
    })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();
  const cancelAudited = await auditedBookings(cancelled, APP_CANCEL_ACTIONS);
  const cancelFindings = cancelled
    .filter((booking) => !hasAudit(cancelAudited, booking))
    .map((booking) => ({ ...pickBooking(booking), cancelledAt: booking.cancellation?.cancelledAt || null, cancelledBy: booking.cancellation?.cancelledBy || "" }));

  // 3. Supplier bookings Bokun reports as amended, with no change started inside the application.
  const amended = await bookings
    .find({
      ...supplierBooking,
      ...touchedSince,
      "bokunOperationalDates.amendmentDate.raw": { $type: "string", $ne: "" }
    })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();
  const changeAudited = await auditedBookings(amended, APP_CHANGE_ACTIONS);
  const amendmentFindings = amended
    .filter((booking) => !hasAudit(changeAudited, booking))
    .map((booking) => ({ ...pickBooking(booking), amendedAt: booking.bokunOperationalDates?.amendmentDate?.raw || "" }));

  const report = {
    mode: "read-only",
    database: redactUri(uri),
    since: since.toISOString(),
    limitPerCheck: limit,
    scanned: { unpaidCandidates: unpaid.length, cancelledBookings: cancelled.length, amendedBookings: amended.length },
    findings: {
      supplierBookingsWithoutPayment: unpaidFindings,
      cancellationsWithoutAppAudit: cancelFindings,
      amendmentsWithoutAppAudit: amendmentFindings
    },
    notes: [
      "Findings are leads. Confirm each one in the Bokun dashboard (who created, cancelled or amended it, and through which channel).",
      "Bookings created through the endpoint appear here only after the confirmed-booking import pulled them in; also review Bokun for bookings in the website channel that are missing locally.",
      "Server access logs for POST/GET /api/bokun/bookings* are the only direct evidence of calls to the endpoints."
    ]
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Read-only audit of ${report.database} since ${report.since}`);
    console.log(`Scanned: ${JSON.stringify(report.scanned)}`);
    const section = (title, rows) => {
      console.log(`\n${title}: ${rows.length}`);
      if (rows.length) console.table(rows.map(({ bookingReference, bokunBookingId, operationalSource, bookingStatus, paymentStatus, bokunPaymentStatus, severity, cancelledBy, amendedAt }) =>
        ({ bookingReference, bokunBookingId, operationalSource, bookingStatus, paymentStatus, bokunPaymentStatus, ...(severity ? { severity } : {}), ...(cancelledBy !== undefined ? { cancelledBy } : {}), ...(amendedAt !== undefined ? { amendedAt } : {}) })));
    };
    section("Supplier bookings without a settled payment", unpaidFindings);
    section("Cancellations without an application audit entry", cancelFindings);
    section("Amendments without an application audit entry", amendmentFindings);
    console.log(`\n${report.notes.map((note) => `- ${note}`).join("\n")}`);
  }

  return report;
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { main };
