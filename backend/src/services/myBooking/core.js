// Pure rules for the guest "My booking" area: secrets, hashing, masking and references. No database or network.
const crypto = require("crypto");

const LINK_TTL_MINUTES = 30;
const SESSION_TTL_DAYS = 30;
const CONTACT_CODE_TTL_MINUTES = 10;
const CONTACT_CODE_MAX_ATTEMPTS = 5;
// Bookings opened with the key in a payment link (the confirmation page) for this long after they were made.
const PAYMENT_KEY_SESSION_DAYS = 7;

// No 0/O, 1/I/L: the reference is read out on the phone and typed from a ticket.
const REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const REFERENCE_LENGTH = 8;

const text = (value) => String(value ?? "").trim();

// 32 random bytes (256 bits) as base64url, for links and sessions.
const randomSecret = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

// Secrets are stored only as their SHA-256, so a database copy never opens a booking.
const hashSecret = (value = "") => crypto.createHash("sha256").update(text(value)).digest("hex");

const safeEqual = (a = "", b = "") => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

// "ZNZ-7F3K9Q2M": random, uppercase, no ambiguous characters.
const buildBookingReference = (randomInt = crypto.randomInt) => {
  let code = "";
  for (let index = 0; index < REFERENCE_LENGTH; index += 1) code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `ZNZ-${code}`;
};

// What a guest types: spaces removed, upper case ("znz- 1792…" → "ZNZ-1792…").
const normalizeReference = (value = "") => text(value).toUpperCase().replace(/\s+/g, "");
// Website references start with ZNZ-; bookings imported from other channels keep their own letters.
const isPlausibleReference = (value = "") => /^[A-Z0-9][A-Z0-9-]{4,40}$/.test(normalizeReference(value));
const normalizeEmail = (value = "") => text(value).toLowerCase();

// The double-submit token for a session: sent in X-CSRF-Token with every change, never stored.
const csrfTokenFor = (sessionId = "", secret = "") =>
  crypto.createHmac("sha256", String(secret)).update(`riser-my-booking-csrf:${text(sessionId)}`).digest("base64url");

// What the ticket's QR code holds: the reference and a short signature (no personal data).
const ticketCode = (reference = "", secret = "") => {
  const ref = normalizeReference(reference);
  const signature = crypto.createHmac("sha256", String(secret)).update(`riser-ticket:${ref}`).digest("base64url").slice(0, 12);
  return `ZTS:${ref}:${signature}`;
};

const sixDigitCode = (randomInt = crypto.randomInt) => String(randomInt(0, 1000000)).padStart(6, "0");

// "Amani Bakari" → "A•••• B••••"
const maskName = (first = "", last = "") =>
  [first, last]
    .map(text)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}••••`)
    .join(" ");

// "amani@email.com" → "a•••@email.com"
const maskEmail = (email = "") => {
  const value = text(email);
  const at = value.indexOf("@");
  if (at < 1) return "";
  return `${value[0]}•••${value.slice(at)}`;
};

// "+255 778 775 123" → "+••• ••• ••• 123"
const maskPhone = (phone = "") => {
  const digits = text(phone).replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `+••• ••• ••• ${digits.slice(-3)}`;
};

module.exports = {
  LINK_TTL_MINUTES,
  SESSION_TTL_DAYS,
  CONTACT_CODE_TTL_MINUTES,
  CONTACT_CODE_MAX_ATTEMPTS,
  PAYMENT_KEY_SESSION_DAYS,
  REFERENCE_ALPHABET,
  randomSecret,
  hashSecret,
  safeEqual,
  buildBookingReference,
  normalizeReference,
  isPlausibleReference,
  normalizeEmail,
  csrfTokenFor,
  ticketCode,
  sixDigitCode,
  maskName,
  maskEmail,
  maskPhone
};
