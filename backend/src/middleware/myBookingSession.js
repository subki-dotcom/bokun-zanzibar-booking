// "My booking" session cookie: httpOnly, SameSite=Lax, Secure in production, 30 days. The cookie holds a random
// token; the server keeps only its hash, so signing out (or deleting the session) ends it everywhere.
const { env } = require("../config/env");
const AppError = require("../utils/AppError");
const myBooking = require("../services/myBooking");
const { SESSION_TTL_DAYS, safeEqual } = require("../services/myBooking/core");

const isProduction = () => env.NODE_ENV === "production";
// "__Host-" makes the browser refuse the cookie unless it is Secure, host-only and for the whole site.
const cookieName = () => (isProduction() ? "__Host-rb_session" : "rb_session");

const cookieOptions = () => ({
  httpOnly: true,
  secure: isProduction(),
  sameSite: "lax",
  path: "/"
});

const setSessionCookie = (res, token) =>
  res.cookie(cookieName(), token, { ...cookieOptions(), maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000 });

const clearSessionCookie = (res) => res.clearCookie(cookieName(), cookieOptions());

// Booking pages are personal: never stored by the browser or a proxy.
const noStore = (_req, res, next) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");
  res.set("X-Robots-Tag", "noindex, nofollow");
  next();
};

// Loads the session (or none) into req.bookingSession.
const loadSession = async (req, _res, next) => {
  try {
    req.bookingSession = await myBooking.resolveSession(req.cookies?.[cookieName()]);
    next();
  } catch (error) {
    next(error);
  }
};

// Without a valid session the answer is 404, the same as a booking that does not exist.
const requireSession = (req, _res, next) =>
  req.bookingSession ? next() : next(new AppError("Booking not found", 404, "BOOKING_NOT_FOUND"));

// The booking named in the URL must be the session's own booking (404 otherwise).
const requireSessionFor = (param) => (req, _res, next) => {
  const wanted = String(req.params?.[param] || "").trim();
  const session = req.bookingSession;
  const same = session && (wanted === String(session.booking) || wanted.toUpperCase() === String(session.bookingReference).toUpperCase());
  return same ? next() : next(new AppError("Booking not found", 404, "BOOKING_NOT_FOUND"));
};

const allowedOrigins = () =>
  [env.PUBLIC_SITE_URL, ...String(env.FRONTEND_URL || "").split(",")]
    .map((value) => String(value || "").trim().replace(/\/+$/, ""))
    .filter(Boolean);

const foreignOrigin = (req) => {
  const origin = String(req.get("origin") || "").replace(/\/+$/, "");
  const localDev = !isProduction() && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin);
  return Boolean(origin) && !localDev && !allowedOrigins().includes(origin);
};

// Sign-in posts come from the site's own pages only.
const requireSameOrigin = (req, _res, next) =>
  foreignOrigin(req) ? next(new AppError("This request was blocked.", 403, "MY_BOOKING_ORIGIN_BLOCKED")) : next();

// Every change: from the site's own pages (Origin), with the session's CSRF token in X-CSRF-Token.
const requireCsrf = (req, _res, next) => {
  if (foreignOrigin(req)) return next(new AppError("This request was blocked.", 403, "MY_BOOKING_ORIGIN_BLOCKED"));
  const token = String(req.get("x-csrf-token") || "");
  if (!req.bookingSession || !token || !safeEqual(token, myBooking.csrfToken(req.bookingSession))) {
    return next(new AppError("Your session needs refreshing. Please reload the page.", 403, "MY_BOOKING_CSRF_INVALID"));
  }
  return next();
};

module.exports = {
  cookieName,
  setSessionCookie,
  clearSessionCookie,
  noStore,
  loadSession,
  requireSession,
  requireSessionFor,
  requireSameOrigin,
  requireCsrf
};
