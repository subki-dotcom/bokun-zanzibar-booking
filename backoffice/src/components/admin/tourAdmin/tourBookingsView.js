// Display rules and the CSV export for the Tour Bookings page. Labels only: the status values sent to and received
// from the server are never changed.

export const PAGE_SIZES = [10, 25, 50];
const ZANZIBAR_OFFSET_MS = 3 * 3600000;

// Today in Zanzibar (UTC+3, no daylight saving) as YYYY-MM-DD, and days added to such a date.
export const zanzibarToday = (now = new Date()) => new Date(now.getTime() + ZANZIBAR_OFFSET_MS).toISOString().slice(0, 10);
export const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

const monthBounds = (today) => {
  const [year, month] = today.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
};

// Travel-date ranges offered in the page header.
export const datePresets = (today = zanzibarToday()) => [
  { id: "all", label: "All travel dates", from: "", to: "" },
  { id: "this-month", label: "This month", ...monthBounds(today) },
  { id: "next-30", label: "Next 30 days", from: today, to: addDays(today, 30) },
  { id: "last-30", label: "Last 30 days", from: addDays(today, -30), to: today }
];

export const presetFor = (from, to, today = zanzibarToday()) =>
  datePresets(today).find((preset) => preset.from === (from || "") && preset.to === (to || ""))?.id || "custom";

export const BOOKING_STATUS_VIEW = Object.freeze({
  confirmed: { label: "Confirmed", tone: "success" },
  pending: { label: "Pending", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "danger" },
  failed: { label: "Failed", tone: "neutral" },
  edit_requested: { label: "Change requested", tone: "info" }
});

export const PAYMENT_STATUS_VIEW = Object.freeze({
  paid: { label: "Paid", tone: "success" },
  pending: { label: "Unpaid", tone: "orange" },
  initiated: { label: "Unpaid", tone: "orange" },
  processing: { label: "Verifying", tone: "info" },
  partial: { label: "Partially paid", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
  verification_error: { label: "Check failed", tone: "danger" },
  refunded: { label: "Refunded", tone: "neutral" },
  partially_refunded: { label: "Partly refunded", tone: "neutral" }
});

const words = (value = "") => String(value || "-").replaceAll("_", " ").replace(/^\w/, (character) => character.toUpperCase());

export const bookingStatusView = (status) => BOOKING_STATUS_VIEW[status] || { label: words(status), tone: "neutral" };
export const paymentStatusView = (status) => PAYMENT_STATUS_VIEW[status] || { label: words(status), tone: "neutral" };

export const customerName = (customer = {}) => `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || customer.email || "-";

export const initials = (customer = {}) => {
  const letters = [customer.firstName, customer.lastName].filter(Boolean).map((part) => part.trim()[0]).join("");
  return (letters || (customer.email || "?")[0] || "?").toUpperCase().slice(0, 2);
};

export const paxSummary = (pax = {}) => {
  const parts = [
    pax.adults ? `${pax.adults} adult${pax.adults === 1 ? "" : "s"}` : "",
    pax.children ? `${pax.children} child${pax.children === 1 ? "" : "ren"}` : "",
    pax.infants ? `${pax.infants} infant${pax.infants === 1 ? "" : "s"}` : ""
  ].filter(Boolean);
  return parts.join(", ") || "-";
};

export const paxTotal = (pax = {}) => Number(pax.total || 0) || Number(pax.adults || 0) + Number(pax.children || 0) + Number(pax.infants || 0);

// "Oct 20, 2026" for a YYYY-MM-DD travel date (already a local Zanzibar date).
export const formatTravelDate = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return date || "-";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};

// The page numbers shown in the pager: a window of five around the current page.
export const pageWindow = (page, totalPages) => {
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  return Array.from({ length: Math.min(5, totalPages) }, (_, index) => start + index);
};

// ---------- CSV export ----------
const EXPORT_COLUMNS = [
  ["Booking reference", (booking) => booking.bookingReference],
  ["Customer", (booking) => customerName(booking.customer)],
  ["Email", (booking) => booking.customer?.email],
  ["Phone", (booking) => booking.customer?.phone],
  ["Hotel", (booking) => booking.customer?.hotelName],
  ["Tour", (booking) => booking.tour?.productTitle],
  ["Option", (booking) => booking.tour?.optionTitle],
  ["Travel date", (booking) => booking.tour?.travelDate],
  ["Start time", (booking) => booking.tour?.startTime],
  ["Pax", (booking) => paxTotal(booking.tour?.pax)],
  ["Travellers", (booking) => paxSummary(booking.tour?.pax)],
  ["Booking status", (booking) => bookingStatusView(booking.status?.booking).label],
  ["Payment status", (booking) => paymentStatusView(booking.status?.payment).label],
  ["Supplier status", (booking) => booking.status?.supplier],
  ["Origin", (booking) => booking.origin],
  ["Assignment", () => "Not assigned"]
];

const csvCell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  // Cells that a spreadsheet would run as a formula are prefixed with an apostrophe.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export const bookingsCsv = (bookings = []) =>
  [EXPORT_COLUMNS.map(([label]) => label), ...bookings.map((booking) => EXPORT_COLUMNS.map(([, read]) => read(booking)))]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");

// Fetches every page of the current filters (100 per request, at most `maxRows`) for the export.
export const fetchAllPages = async (fetchPage, filters, maxRows = 5000) => {
  const rows = [];
  for (let page = 1; rows.length < maxRows; page += 1) {
    const result = await fetchPage({ ...filters, page, limit: 100 });
    rows.push(...(result?.items || []));
    if (!result?.hasMore || !result.items?.length) return { rows, truncated: false, total: result?.total ?? rows.length };
  }
  return { rows: rows.slice(0, maxRows), truncated: true, total: rows.length };
};
