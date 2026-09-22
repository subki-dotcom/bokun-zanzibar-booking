const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Booking = require("../src/models/Booking");
const AccountingPosting = require("../src/models/AccountingPosting");
const JournalEntry = require("../src/models/JournalEntry");
const EXPECTED_DATABASE = "bokun_zanzibar_booking";
const token = (value) => String(value || "").trim();
const upper = (value) => token(value).toUpperCase();
const asArray = (value) => Array.isArray(value) ? value : [];
const count = (rows, key) => rows.reduce((result, row) => { const value = upper(key(row)) || "UNKNOWN"; result[value] = (result[value] || 0) + 1; return result; }, {});
const activityStatuses = (booking) => {
  const raw = booking.rawBokunResponse?.booking || booking.rawBokunResponse || {};
  return [...asArray(raw.activityBookings), ...asArray(raw.routeBookings)].map((item) => ({ status: upper(item.status), productId: token(item.productId || item.product?.id || item.id), title: token(item.title || item.product?.title) }));
};
async function main() {
  if (process.argv.includes("--apply")) throw new Error("This audit is read-only; --apply is not supported.");
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required from backend/.env");
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, readPreference: "secondaryPreferred" });
  const databaseName = mongoose.connection.db.databaseName;
  console.log(JSON.stringify({ connected: true, databaseName }));
  if (databaseName !== EXPECTED_DATABASE) throw new Error(`Unexpected database name: ${databaseName}`);
  const [bookings, postings, journals] = await Promise.all([
    Booking.find({}).select("bookingReference bookingStatus travelDate salesChannel transactionCurrency currency pricingSnapshot bokunBookingId bokunProductId bokunOptionId rawBokunResponse").lean(),
    AccountingPosting.find({}).select("postingKey postingType sourceModule sourceReference bookingReference currency transactionDate status").lean(),
    JournalEntry.find({}).select("entryNumber source status postingDate currency").lean()
  ]);
  const now = new Date();
  const result = {
    readOnly: true, generatedAt: now.toISOString(), databaseName,
    scanned: { bookings: bookings.length, accountingPostings: postings.length, journalEntries: journals.length },
    bookingStatuses: count(bookings, (row) => row.bookingStatus),
    bokunEvidence: { activityAndRouteRows: 0, statuses: {}, arrived: 0, noShow: 0, cancelled: 0, confirmed: 0, unknown: 0 },
    serviceDates: { missing: 0, past: 0, future: 0, confirmedPast: 0 },
    completionLikeFields: { count: 0, fields: {} },
    accountingEvidence: { postingTypes: count(postings, (row) => row.postingType), sourceModules: count(postings, (row) => row.sourceModule), revenueLikePostings: postings.filter((row) => /REVENUE|INCOME|BOOKING/i.test(`${row.postingType} ${row.sourceModule}`)).length, postedJournals: journals.filter((row) => upper(row.status) === "POSTED").length },
    currencies: count(bookings, (row) => row.transactionCurrency || row.currency || row.pricingSnapshot?.currency),
    duplicatePotentialCompletionIdentities: {},
    classifications: { AUTHORITATIVE_COMPLETION_EVIDENCE: 0, ATTENDANCE_EVIDENCE_ONLY: 0, NO_SHOW_EVIDENCE: 0, CANCELLATION_EVIDENCE: 0, INSUFFICIENT: 0, AMBIGUOUS: 0, NEEDS_MANUAL_REVIEW: 0 },
    exceptions: []
  };
  const identities = new Map();
  for (const booking of bookings) {
    const statuses = activityStatuses(booking);
    result.bokunEvidence.activityAndRouteRows += statuses.length;
    statuses.forEach((item) => { result.bokunEvidence.statuses[item.status || "UNKNOWN"] = (result.bokunEvidence.statuses[item.status || "UNKNOWN"] || 0) + 1; if (item.status === "ARRIVED") result.bokunEvidence.arrived += 1; else if (item.status === "NO_SHOW") result.bokunEvidence.noShow += 1; else if (item.status === "CANCELLED") result.bokunEvidence.cancelled += 1; else if (item.status === "CONFIRMED") result.bokunEvidence.confirmed += 1; else result.bokunEvidence.unknown += 1; const key = `${booking.bookingReference}:${item.productId || "UNKNOWN"}`; identities.set(key, (identities.get(key) || 0) + 1); });
    const serviceDate = booking.travelDate ? new Date(booking.travelDate) : null;
    if (!serviceDate || Number.isNaN(serviceDate.getTime())) result.serviceDates.missing += 1; else if (serviceDate < now) { result.serviceDates.past += 1; if (upper(booking.bookingStatus) === "CONFIRMED") result.serviceDates.confirmedPast += 1; } else result.serviceDates.future += 1;
    ["completion", "completedAt", "serviceCompletion", "revenueRecognition"].forEach((field) => { if (booking[field] !== undefined && booking[field] !== null && booking[field] !== "") { result.completionLikeFields.count += 1; result.completionLikeFields.fields[field] = (result.completionLikeFields.fields[field] || 0) + 1; } });
    if (statuses.some((item) => item.status === "ARRIVED")) result.classifications.ATTENDANCE_EVIDENCE_ONLY += 1; else if (statuses.some((item) => item.status === "NO_SHOW")) result.classifications.NO_SHOW_EVIDENCE += 1; else if (statuses.some((item) => item.status === "CANCELLED")) result.classifications.CANCELLATION_EVIDENCE += 1; else result.classifications.INSUFFICIENT += 1;
    if (statuses.length && (statuses.some((item) => item.status === "ARRIVED") || statuses.some((item) => item.status === "NO_SHOW"))) result.exceptions.push({ bookingReference: booking.bookingReference, statuses: statuses.map((item) => item.status).filter(Boolean), reason: "BOKUN_STATUS_REQUIRES_EXPLICIT_LOCAL_COMPLETION_POLICY" });
  }
  for (const [key, value] of identities) if (value > 1) result.duplicatePotentialCompletionIdentities[key] = value;
  result.readiness = {
    customerRevenueRecognition: result.classifications.AUTHORITATIVE_COMPLETION_EVIDENCE > 0
      ? "REQUIRES_POLICY_AND_POSTING_REVIEW"
      : "BLOCKED_INSUFFICIENT_COMPLETION_EVIDENCE",
    customerArRecognition: "BLOCKED_INSUFFICIENT_COMPLETION_EVIDENCE",
    mutationCounters: { productionRecordsChanged: 0, journalEntriesCreated: 0, glPostingsCreated: 0, bokunRecordsModified: 0 }
  };
  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
}
main().catch(async (error) => { console.error(error.message); await mongoose.disconnect().catch(() => {}); process.exitCode = 1; });
