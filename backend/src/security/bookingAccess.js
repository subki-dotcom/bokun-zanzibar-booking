const crypto = require("node:crypto");
const { env } = require("../config/env");
const { ROLES } = require("../config/constants");

// Customer access to a tour booking. Booking references (ZNZ-<timestamp>-<nonce>) and invoice
// numbers (INV-<date>-<sequence>) are guessable, so neither may open a booking on its own.
// The token is an HMAC over the booking id, its access version and an expiry, keyed by a key
// derived from a server secret. It is never stored, so a database copy cannot open bookings, and
// raising Booking.customerAccessVersion revokes every token issued for that booking.
const ACCESS_TOKEN_HEADER = "X-Booking-Access-Token";
const TOKEN_PATTERN = /^[0-9a-z]{1,12}\.[A-Za-z0-9_-]{43}$/;
const BACK_OFFICE_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF];

const accessKey = () =>
  crypto
    .createHmac("sha256", String(env.BOOKING_ACCESS_TOKEN_SECRET || env.JWT_SECRET))
    .update("riser-tour-booking-access-v1")
    .digest();

const signature = ({ bookingId, accessVersion, expiresAt }) =>
  crypto.createHmac("sha256", accessKey()).update(`${bookingId}:${accessVersion}:${expiresAt}`).digest("base64url");

const accessVersionOf = (booking = {}) => Number(booking.customerAccessVersion || 0);

const issueBookingAccessToken = (booking = {}, { now = Date.now(), ttlDays = env.BOOKING_ACCESS_TOKEN_TTL_DAYS } = {}) => {
  const bookingId = String(booking._id || booking.bookingId || "");
  if (!bookingId) return null;
  const expiresAt = Math.floor(now / 1000) + Math.max(1, Number(ttlDays || 0)) * 24 * 60 * 60;
  return {
    token: `${expiresAt.toString(36)}.${signature({ bookingId, accessVersion: accessVersionOf(booking), expiresAt })}`,
    expiresAt: new Date(expiresAt * 1000).toISOString()
  };
};

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
};

const verifyBookingAccessToken = (booking, token, { now = Date.now() } = {}) => {
  if (!booking?._id || typeof token !== "string" || !TOKEN_PATTERN.test(token)) return false;
  const [expiryPart, provided] = token.split(".");
  const expiresAt = Number.parseInt(expiryPart, 36);
  if (!Number.isSafeInteger(expiresAt) || expiresAt * 1000 <= now) return false;
  const expected = signature({ bookingId: String(booking._id), accessVersion: accessVersionOf(booking), expiresAt });
  return safeEqual(provided, expected);
};

const isBackOfficeUser = (auth) =>
  Boolean(auth) && auth.userType !== "agent" && BACK_OFFICE_ROLES.includes(auth.role);

const isOwningAgent = (auth, booking) =>
  Boolean(auth) &&
  auth.role === ROLES.AGENT &&
  Boolean(booking?.agentId) &&
  String(booking.agentId) === String(auth.id || "");

// "back_office" | "agent" | "customer" | null. Callers must treat null exactly like "not found".
const resolveBookingAccess = ({ booking, auth = null, accessToken = "" } = {}) => {
  if (!booking) return null;
  if (isBackOfficeUser(auth)) return "back_office";
  if (isOwningAgent(auth, booking)) return "agent";
  if (accessToken && verifyBookingAccessToken(booking, accessToken)) return "customer";
  return null;
};

const normalizeEmail = (value = "") => String(value || "").trim().toLowerCase();

// Compares digests so the comparison time does not depend on where the addresses differ.
const emailMatches = (provided, stored) => {
  const left = normalizeEmail(provided);
  const right = normalizeEmail(stored);
  if (!left || !right) return false;
  const digest = (value) => crypto.createHash("sha256").update(value).digest();
  return crypto.timingSafeEqual(digest(left), digest(right));
};

const INVOICE_CUSTOMER_FIELDS = [
  "invoiceNumber", "bookingReference", "invoiceType", "issueDate", "dueDate", "paymentStatus", "bookingStatus",
  "clientName", "clientPhone", "clientEmail", "clientCountry", "hotelName", "tourName", "bookedOption", "tourDate",
  "pickupTime", "pickupLocation", "dropoffLocation", "duration", "adults", "children", "totalPax", "guideLanguage",
  "included", "excluded", "subtotal", "discount", "tax", "total", "amountPaid", "amountRefunded",
  "netAmountPaid", "balanceDue", "guestPaymentCollector", "transactionCurrency", "accountingCurrency", "currency",
  "paymentMethod", "notes", "cancellationPolicy", "paymentTerms", "createdAt", "updatedAt"
];

// What a customer or the owning Agent may see: no ledger, posting or delivery-evidence internals.
const toCustomerInvoice = (invoice = {}) => {
  const view = {};
  for (const field of INVOICE_CUSTOMER_FIELDS) {
    if (invoice[field] !== undefined) view[field] = invoice[field];
  }
  view.items = (invoice.items || []).map((item) => ({
    label: item.label,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    total: item.total
  }));
  return view;
};

const pick = (source = {}, fields = []) =>
  fields.reduce((view, field) => (source?.[field] === undefined ? view : { ...view, [field]: source[field] }), {});

// Payment-provider return pages only need status and display fields. Some provider paths return a
// whole Booking document (raw supplier responses, cost snapshots, commission); never echo those.
const toCustomerPaymentBooking = (booking) => {
  if (!booking || typeof booking !== "object") return booking;
  const source = typeof booking.toObject === "function" ? booking.toObject() : booking;
  const pricing = source.pricingSnapshot || source.pricing;
  const invoice = source.invoiceSnapshot || source.invoice;
  return {
    ...pick(source, [
      "bookingReference", "bokunBookingId", "bokunConfirmationCode", "paymentStatus", "bookingStatus",
      "supplierStatus", "amount", "amountPaid", "currency", "invoiceStatus", "paidAt", "productTitle",
      "optionTitle", "travelDate", "startTime", "sourceChannel", "paymentMethod", "message", "analyticsPurchase"
    ]),
    bookingId: source.bookingId || source._id,
    confirmationCode: source.confirmationCode || source.bokunConfirmationCode || "",
    isAgentBooking: source.isAgentBooking ?? Boolean(source.agentId),
    ...(pricing
      ? { pricingSnapshot: pick(pricing, ["currency", "baseAmount", "extraAmount", "grossAmount", "discountAmount", "finalPayable", "amountPaid", "lineItems"]) }
      : {}),
    ...(invoice
      ? { invoiceSnapshot: pick(invoice, ["invoiceNumber", "total", "amountPaid", "balanceDue", "paymentStatus", "currency"]) }
      : {}),
    ...(source.pendingCheckout
      ? {
          pendingCheckout: {
            finalizationPending: Boolean(source.pendingCheckout.finalizationPending),
            ...(source.pendingCheckout.paidAmount !== undefined ? { paidAmount: source.pendingCheckout.paidAmount } : {})
          }
        }
      : {})
  };
};

// Public website origin for customer links. FRONTEND_URL may list several CORS origins; the first
// is the customer site. Production links must be https so a credential is never sent in clear.
const customerSiteOrigin = () => {
  try {
    const url = new URL(String(env.FRONTEND_URL || "").split(",")[0].trim());
    if (url.username || url.password) return "";
    if (env.NODE_ENV === "production" && url.protocol !== "https:") return "";
    if (!["https:", "http:"].includes(url.protocol)) return "";
    return url.origin;
  } catch {
    return "";
  }
};

// Customer booking link. The token travels in the URL fragment, which browsers never send to
// servers or in Referer headers, so it stays out of hosting access logs and third-party requests.
const customerBookingUrl = (booking = {}) => {
  const origin = customerSiteOrigin();
  if (!origin || !booking.bookingReference) return "";
  const base = `${origin}/my-booking/${encodeURIComponent(booking.bookingReference)}`;
  const access = booking._id ? issueBookingAccessToken(booking) : null;
  return access ? `${base}#access=${encodeURIComponent(access.token)}` : base;
};

// Checkout creates a new booking whenever no bookingId is sent, and only that response receives the
// booking's token. A payment retry for an existing bookingId never mints one.
const withNewBookingAccess = (data, requestBody = {}) => {
  if (requestBody?.bookingId || !data?.bookingId) return data;
  const access = issueBookingAccessToken({ _id: data.bookingId });
  return access ? { ...data, bookingAccessToken: access.token, bookingAccessExpiresAt: access.expiresAt } : data;
};

const withCustomerPaymentBooking = (data) =>
  data?.booking ? { ...data, booking: toCustomerPaymentBooking(data.booking) } : data;

module.exports = {
  ACCESS_TOKEN_HEADER,
  customerSiteOrigin,
  customerBookingUrl,
  withNewBookingAccess,
  withCustomerPaymentBooking,
  issueBookingAccessToken,
  verifyBookingAccessToken,
  resolveBookingAccess,
  isBackOfficeUser,
  isOwningAgent,
  emailMatches,
  toCustomerInvoice,
  toCustomerPaymentBooking
};
