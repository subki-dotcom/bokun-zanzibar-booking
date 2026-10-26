// Pure helpers for "My booking" (mockups MyBooking, MyBookingMobile, MyBookingLookup). Dates are Zanzibar dates
// ("2026-11-30") and times "HH:mm" in Zanzibar time; nothing here depends on the visitor's time zone.

const ZANZIBAR_OFFSET_MS = 3 * 60 * 60 * 1000;

const utcDate = (date = "") => {
  const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)) : null;
};

const format = (date, options) => {
  const value = utcDate(date);
  return value ? value.toLocaleDateString("en-GB", { ...options, timeZone: "UTC" }).replace(/,(?= \d)/, "") : "";
};

// "Monday, 30 November 2026"
export const longDate = (date) => {
  const value = utcDate(date);
  if (!value) return "";
  const weekday = value.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return `${weekday}, ${format(date, { day: "numeric", month: "long", year: "numeric" })}`;
};
// "Monday, 30 November"
export const longDateNoYear = (date) => {
  const value = utcDate(date);
  if (!value) return "";
  return `${value.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}, ${format(date, { day: "numeric", month: "long" })}`;
};
// "Mon, 30 Nov"
export const shortDate = (date) => {
  const value = utcDate(date);
  if (!value) return "";
  return `${value.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}, ${format(date, { day: "numeric", month: "short" })}`;
};
// "Mon, 30 Nov 2026"
export const shortDateYear = (date) => (utcDate(date) ? `${shortDate(date)} ${utcDate(date).getUTCFullYear()}` : "");
// "30 Nov 2026"
export const ticketDate = (date) => format(date, { day: "numeric", month: "short", year: "numeric" });
// "Sun" – the weekday before the trip.
export const dayBeforeLabel = (date) => {
  const value = utcDate(date);
  if (!value) return "";
  return new Date(value.getTime() - 86400000).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
};

// An instant (ISO) as Zanzibar "29 Nov, 09:00" / "Sun, 29 Nov, 09:00" / "30 Nov".
const zanzibarParts = (iso = "") => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const local = new Date(ms + ZANZIBAR_OFFSET_MS);
  return {
    day: local.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
    weekday: local.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
    time: local.toISOString().slice(11, 16)
  };
};
export const instantDayTime = (iso) => {
  const parts = zanzibarParts(iso);
  return parts ? `${parts.day}, ${parts.time}` : "";
};
export const instantWeekdayDayTime = (iso) => {
  const parts = zanzibarParts(iso);
  return parts ? `${parts.weekday}, ${parts.day}, ${parts.time}` : "";
};
export const instantDay = (iso) => zanzibarParts(iso)?.day || "";
export const paidOnLabel = (iso) => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + ZANZIBAR_OFFSET_MS).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

// "34 days to go" / "Tomorrow" / "Today" / "" (the mobile banner line and the dark key-fact tile).
export const daysToGoText = ({ phase, daysToGo }) => {
  if (phase === "today") return "Today";
  if (phase !== "upcoming" || daysToGo === null || daysToGo === undefined) return "";
  return daysToGo === 1 ? "Tomorrow" : `${daysToGo} days to go`;
};

// The dark tile: number and caption, or a word on the day and after the trip.
export const countdownTile = ({ phase, daysToGo, status }) => {
  if (status === "cancelled") return { big: "—", label: "Cancelled", caption: "" };
  if (phase === "today") return { big: "0", label: "Today", caption: "Enjoy your trip!" };
  if (phase === "past") return { big: "✓", label: "Completed", caption: "Leave a review" };
  if (phase === "upcoming") return { big: String(daysToGo), label: daysToGo === 1 ? "Day to go" : "Days to go", caption: "Get ready!" };
  return { big: "—", label: "Date", caption: "To be confirmed" };
};

// The free-cancellation bar: share of the time from now to the trip that is still free (green), the rest red.
export const policyBar = ({ policy = {}, now = Date.now() }) => {
  const deadline = Date.parse(policy?.span?.deadlineAt || "");
  const trip = Date.parse(policy?.span?.tripAt || "");
  if (!Number.isFinite(deadline) || !Number.isFinite(trip) || trip <= now) return null;
  const free = Math.max(0, Math.min(1, (deadline - now) / (trip - now)));
  return { freePercent: Math.round(free * 1000) / 10, deadlinePassed: now > deadline };
};

export const whatsappTripHref = (baseHref = "", reference = "", title = "") => {
  if (!baseHref) return "";
  const text = `Hi, I have a question about my booking ${reference}${title ? ` (${title})` : ""}.`;
  return `${baseHref}?text=${encodeURIComponent(text)}`;
};

export const whatsappPickupHref = (baseHref = "", reference = "") =>
  baseHref ? `${baseHref}?text=${encodeURIComponent(`Hi, I'd like to change the pickup for booking ${reference}. New pickup: `)}` : "";

// What "Share trip" shares: the tour and the date only, never the private link or the reference.
export const shareText = (data = {}) =>
  `I'm going on ${data.tour?.title || "a Zanzibar trip"} on ${longDate(data.date)}${data.startTime ? ` at ${data.startTime} (Zanzibar time)` : ""}!`;

export const CANCEL_REASONS = [
  ["change_of_plans", "My plans changed"],
  ["flight_cancellation", "My flight was cancelled"],
  ["flight_delay", "My flight was delayed"],
  ["medical_reason", "Health reasons"],
  ["weather_concern", "Weather concerns"],
  ["booked_by_mistake", "I booked by mistake"],
  ["duplicate_booking", "I booked twice"],
  ["other", "Other"]
];

// "A•••• B••••" in the e-ticket, from the server (already masked); never derived here.
export const money = (amount, currency = "USD") => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount || 0));
  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
};
