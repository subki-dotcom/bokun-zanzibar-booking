export const STATUS = Object.freeze({
  QUOTE_REQUESTED: { label: "Quote requested", bg: "info", text: "dark" },
  AWAITING_PAYMENT: { label: "Awaiting payment", bg: "warning", text: "dark" },
  CONFIRMED: { label: "Confirmed", bg: "success" },
  REJECTED: { label: "Rejected", bg: "secondary" },
  CANCELLED: { label: "Cancelled", bg: "dark" }
});
export const statusMeta = (status) => STATUS[status] || { label: status || "—", bg: "light", text: "dark" };

export const PAYMENT = Object.freeze({ UNPAID: "Unpaid", PAID: "Paid", REFUNDED: "Refunded" });
export const ARRANGEMENT = Object.freeze({ ONLINE: "Online", CASH_ON_ARRIVAL: "Cash on arrival" });
export const CHANNELS = Object.freeze([
  ["WHATSAPP", "WhatsApp"],
  ["PHONE", "Phone"],
  ["EMAIL", "Email"],
  ["WALK_IN", "Walk-in"],
  ["OTHER", "Other"]
]);
export const LOCATION_TYPES = Object.freeze([
  ["AIRPORT", "Airport"],
  ["PORT", "Port / ferry"],
  ["HOTEL", "Hotel"],
  ["AREA", "Area"],
  ["OTHER", "Other"]
]);

export const usd = (amount) => (amount === null || amount === undefined || amount === "" ? "—" : `USD ${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

const ZANZIBAR = "Africa/Dar_es_Salaam";
export const dateTime = (value) =>
  value ? new Date(value).toLocaleString("en-GB", { timeZone: ZANZIBAR, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const legWhen = (leg) => (leg ? `${leg.localDate} ${leg.localTime}` : "—");
export const passengers = (p = {}) => [`${p.adults || 0} ad`, p.children ? `${p.children} ch` : "", p.infants ? `${p.infants} inf` : ""].filter(Boolean).join(" · ");

// Zanzibar "today" as YYYY-MM-DD.
export const zanzibarToday = (now = new Date()) => new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10);

export const newIdempotencyKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

// The customer's private link on the website. The token stays in the fragment.
export const websiteBase = () => String(import.meta.env?.VITE_WEBSITE_URL || (import.meta.env?.PROD ? "https://zanzibartoursandsafaris.co.tz" : "http://localhost:5173")).replace(/\/+$/, "");

export const fieldErrors = (error) => error?.details?.fieldErrors?.body || [];
