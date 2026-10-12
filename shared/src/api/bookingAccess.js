// Customer access tokens for tour bookings. A booking reference alone never opens a booking: the
// API needs the token issued at checkout, carried by booking emails, or obtained through an emailed
// single-use verification link. Tokens are kept per reference in this browser and sent only as a
// request header, never in an API URL.
export const BOOKING_ACCESS_HEADER = "X-Booking-Access-Token";
const STORAGE_KEY = "riser_booking_access";
const VERIFY_KEY = "riser_booking_verify";
const VERIFY_FAILED_KEY = "riser_booking_verify_failed";
const MAX_ENTRIES = 20;
const BOOKING_PATH = /^\/(?:my-booking|invoice|booking-confirmation|payment-status|payment\/checkout)\/([^/?#]+)\/?$/;

const normalizeReference = (reference = "") => String(reference || "").trim().toUpperCase();

const storage = (kind) => {
  try {
    return window[kind] || null;
  } catch {
    return null;
  }
};

const readJson = (kind, key) => {
  try {
    const parsed = JSON.parse(storage(kind)?.getItem(key) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeJson = (kind, key, value) => {
  try {
    storage(kind)?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode); the customer can still request an emailed link.
  }
};

const readAll = () => readJson("localStorage", STORAGE_KEY);

const writeAll = (entries) => {
  const now = Date.now();
  const kept = Object.entries(entries)
    .filter(([, entry]) => entry?.token && (!entry.expiresAt || Date.parse(entry.expiresAt) > now))
    .sort(([, left], [, right]) => String(right.savedAt || "").localeCompare(String(left.savedAt || "")))
    .slice(0, MAX_ENTRIES);
  writeJson("localStorage", STORAGE_KEY, Object.fromEntries(kept));
};

export const rememberBookingAccess = (reference, token, expiresAt = "") => {
  const key = normalizeReference(reference);
  if (!key || !token) return;
  writeAll({ ...readAll(), [key]: { token: String(token), expiresAt: expiresAt || "", savedAt: new Date().toISOString() } });
};

export const forgetBookingAccess = (reference) => {
  const entries = readAll();
  delete entries[normalizeReference(reference)];
  writeAll(entries);
};

export const getBookingAccessToken = (reference) => {
  const entry = readAll()[normalizeReference(reference)];
  if (!entry?.token) return "";
  if (entry.expiresAt && Date.parse(entry.expiresAt) <= Date.now()) return "";
  return entry.token;
};

// Emailed links put credentials in the URL fragment (#access=... or #verify=...), which browsers
// never send to servers or in Referer headers. Run before the app renders so analytics and other
// scripts never see them: store them, then remove them from the address bar and history entry.
// A ?access= query value (links from before the fragment format) is handled the same way.
export const captureBookingAccessFromLocation = () => {
  try {
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    const accessToken = fragment.get("access") || url.searchParams.get("access");
    const verification = fragment.get("verify");
    if (!accessToken && !verification) return;
    const match = url.pathname.match(BOOKING_PATH);
    const reference = match ? decodeURIComponent(match[1]) : "";
    if (reference && accessToken) rememberBookingAccess(reference, accessToken);
    if (reference && verification) {
      writeJson("sessionStorage", VERIFY_KEY, { reference: normalizeReference(reference), verification });
    }
    const fragmentHadCredential = fragment.has("access") || fragment.has("verify");
    for (const key of ["access", "verify"]) fragment.delete(key);
    url.searchParams.delete("access");
    // Leave unrelated fragments (#section) exactly as they were.
    const hash = fragmentHadCredential ? (fragment.toString() ? `#${fragment.toString()}` : "") : url.hash;
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${hash}`);
  } catch {
    // Not running in a browser.
  }
};

// The one-time verification from an emailed link, handed out once.
export const takePendingVerification = (reference) => {
  const pending = readJson("sessionStorage", VERIFY_KEY);
  if (!pending.verification || pending.reference !== normalizeReference(reference)) return "";
  try {
    storage("sessionStorage")?.removeItem(VERIFY_KEY);
  } catch {
    // Nothing stored.
  }
  return pending.verification;
};

export const markVerificationFailed = (reference) =>
  writeJson("sessionStorage", VERIFY_FAILED_KEY, { reference: normalizeReference(reference) });

export const takeVerificationFailure = (reference) => {
  const failed = readJson("sessionStorage", VERIFY_FAILED_KEY);
  if (failed.reference !== normalizeReference(reference)) return false;
  try {
    storage("sessionStorage")?.removeItem(VERIFY_FAILED_KEY);
  } catch {
    // Nothing stored.
  }
  return true;
};

export const bookingAccessHeaders = (reference) => {
  captureBookingAccessFromLocation();
  const token = getBookingAccessToken(reference);
  return token ? { [BOOKING_ACCESS_HEADER]: token } : {};
};

// Payment checkout returns the new booking's token; keep it for the return from the provider.
export const rememberCheckoutAccess = (result = {}) => {
  if (result?.bookingReference && result?.bookingAccessToken) {
    rememberBookingAccess(result.bookingReference, result.bookingAccessToken, result.bookingAccessExpiresAt);
  }
  return result;
};
