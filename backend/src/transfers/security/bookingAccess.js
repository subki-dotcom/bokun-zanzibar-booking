const crypto = require("node:crypto");

// No 0/O, 1/I/L: references are read out over the phone and typed by customers.
const REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const REFERENCE_PATTERN = /^TRF-[2-9A-HJKMNP-Z]{8}$/;

// Random, not sequential, so references cannot be enumerated (31^8 ≈ 8.5e11 possibilities).
const generateBookingReference = (randomInt = crypto.randomInt) => {
  let code = "";
  for (let index = 0; index < 8; index += 1) code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `TRF-${code}`;
};

const generateAccessNonce = () => crypto.randomBytes(16).toString("base64url");

// The customer's access token is an HMAC of a per-booking random nonce, keyed by a key derived from the
// Transfer secret. The token itself is never stored, so a database copy cannot be used to open bookings.
const accessKey = (secret) => crypto.createHmac("sha256", String(secret)).update("riser-transfer-booking-access-v1").digest();

const bookingAccessToken = ({ secret, bookingId, nonce }) =>
  crypto.createHmac("sha256", accessKey(secret)).update(`${bookingId}:${nonce}`).digest("base64url");

const tokenMatches = (provided, expected) => {
  const left = Buffer.from(String(provided || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
};

// Stable fingerprint of what was submitted under an Idempotency-Key, to detect a key reused for a different booking.
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: canonical(value[key]) }), {});
  }
  return value;
};
const requestFingerprint = (payload) => crypto.createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");

const maskEmail = (email = "") => {
  const [name, domain] = String(email).split("@");
  if (!name || !domain) return "";
  return `${name[0]}${"*".repeat(Math.max(2, Math.min(6, name.length - 1)))}@${domain}`;
};

const maskPhone = (phone = "") => {
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `${String(phone).trim().startsWith("+") ? "+" : ""}${"•".repeat(Math.max(3, digits.length - 3))}${digits.slice(-3)}`;
};

module.exports = {
  REFERENCE_PATTERN,
  generateBookingReference,
  generateAccessNonce,
  bookingAccessToken,
  tokenMatches,
  requestFingerprint,
  maskEmail,
  maskPhone
};
