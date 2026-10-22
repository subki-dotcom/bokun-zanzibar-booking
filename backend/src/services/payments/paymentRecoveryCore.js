// Pure rules for the customer payment pages: who may read a booking's payment state, which screen it maps to, and
// whether the saved provider session can still be used. No database or network access here.
const crypto = require("crypto");

const ACCESS_CONTEXT = "riser-payment-access-v1";
// A saved Pesapal order page is offered again for this long; after that a new order is made (after the old one is
// confirmed unpaid with the provider).
const DEFAULT_SESSION_TTL_MINUTES = 60;

const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLowerCase();

// The key in payment links: an HMAC of the booking, so the reference alone never opens personal data.
const paymentAccessKey = (booking = {}, secret = "") => {
  const id = text(booking._id);
  const reference = text(booking.bookingReference);
  if (!id || !reference || !secret) return "";
  return crypto.createHmac("sha256", String(secret)).update(`${ACCESS_CONTEXT}:${id}:${reference}`).digest("base64url").slice(0, 32);
};

// Every provider order id this booking has had (older payment links carry one of these as their key).
const knownOrderIds = (booking = {}) => {
  const pending = booking.pendingCheckout || {};
  return [
    booking.paymentTransactionId,
    booking.dpoTransactionToken,
    pending.pesapalOrderTrackingId,
    ...(Array.isArray(pending.pesapalOrderHistory) ? pending.pesapalOrderHistory.map((entry) => entry?.orderTrackingId) : [])
  ]
    .map(text)
    .filter(Boolean);
};

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const hasPaymentAccess = (booking = {}, key = "", secret = "") => {
  const token = text(key);
  if (token.length < 8) return false;
  const signed = paymentAccessKey(booking, secret);
  if (signed && safeEqual(token, signed)) return true;
  return knownOrderIds(booking).some((id) => safeEqual(token, id));
};

// "a****@example.com"
const maskEmail = (email = "") => {
  const value = text(email);
  const at = value.indexOf("@");
  if (at < 1) return "";
  const name = value.slice(0, at);
  return `${name[0]}${"*".repeat(Math.max(3, Math.min(6, name.length - 1)))}${value.slice(at)}`;
};

// The saved Pesapal order page, while it is recent enough to offer again.
const currentPesapalSession = (booking = {}, { now = Date.now(), ttlMinutes = DEFAULT_SESSION_TTL_MINUTES } = {}) => {
  const pending = booking.pendingCheckout || {};
  const result = pending.pesapalCreateOrderResult || {};
  const redirectUrl = text(pending.pesapalRedirectUrl || result.redirect_url || result.redirectUrl || result.payment_url || result.paymentUrl);
  const orderTrackingId = text(pending.pesapalOrderTrackingId || booking.paymentTransactionId);
  const startedAt = Date.parse(text(pending.pesapalInitializedAt || pending.paymentInitiatedAt));
  if (!redirectUrl || !orderTrackingId || !Number.isFinite(startedAt)) return null;
  const expiresAt = startedAt + Number(ttlMinutes || DEFAULT_SESSION_TTL_MINUTES) * 60 * 1000;
  return { provider: "pesapal", redirectUrl, orderTrackingId, startedAt: new Date(startedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(), expired: now >= expiresAt };
};

const PAID = new Set(["paid", "overpaid"]);
const PROCESSING = new Set(["processing", "verification_error"]);
const FAILED = new Set(["failed", "reversed"]);
const REFUNDED = new Set(["refunded", "partially_refunded"]);

// The screen for this booking: paid | processing | awaiting_payment | expired | failed | cancelled.
const customerPaymentStatus = (booking = {}, options = {}) => {
  const payment = lower(booking.paymentStatus);
  const status = lower(booking.bookingStatus);
  if (PAID.has(payment) || status === "confirmed") return "paid";
  if (status === "cancelled" || REFUNDED.has(payment)) return "cancelled";
  if (PROCESSING.has(payment)) return "processing";
  if (FAILED.has(payment) || status === "failed") return "failed";
  const session = lower(booking.paymentMethod) === "pesapal" || !lower(booking.paymentMethod) || lower(booking.paymentMethod) === "pending"
    ? currentPesapalSession(booking, options)
    : null;
  return session && !session.expired ? "awaiting_payment" : "expired";
};

// The tour start in Zanzibar time (UTC+3, no daylight saving) minus the free-cancellation window, or "".
const cancellationDeadline = (booking = {}) => {
  const snapshot = booking.cancellationPolicySnapshot || {};
  if (snapshot.deadline && !Number.isNaN(Date.parse(snapshot.deadline))) return new Date(snapshot.deadline).toISOString();
  const value = Number(snapshot.freeCancellationCutoffValue ?? snapshot.cutoffValue);
  const unit = lower(snapshot.freeCancellationCutoffUnit || snapshot.cutoffUnit || "hours");
  const hours = Number.isFinite(value) && value > 0 ? value * (/day/.test(unit) ? 24 : /minute/.test(unit) ? 1 / 60 : 1) : 0;
  const date = text(booking.travelDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!hours || !date) return "";
  const [h, m] = (text(booking.startTime).match(/^(\d{1,2}):(\d{2})/) || [0, 0, 0]).slice(1).map(Number);
  const start = Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), h - 3, m);
  return new Date(start - hours * 3600 * 1000).toISOString();
};

// True when the tour day (Zanzibar date) is before today.
const travelDatePassed = (booking = {}, now = Date.now()) => {
  const date = text(booking.travelDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const today = new Date(now + 3 * 3600 * 1000).toISOString().slice(0, 10);
  return date < today;
};

module.exports = {
  DEFAULT_SESSION_TTL_MINUTES,
  paymentAccessKey,
  knownOrderIds,
  hasPaymentAccess,
  maskEmail,
  currentPesapalSession,
  customerPaymentStatus,
  cancellationDeadline,
  travelDatePassed
};
