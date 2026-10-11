const PRODUCTION_FRONTEND_ORIGINS = [
  "https://zanzibartoursandsafaris.co.tz",
  "https://bokun-zanzibar-booking.vercel.app"
];

const DEV_ORIGIN_PATTERN = /^https?:\/\/(127\.0\.0\.1|localhost):\d+$/i;

const normalizeOriginValue = (value = "") => String(value || "").trim().replace(/\/+$/, "");

const splitOrigins = (value = "") =>
  String(value || "")
    .split(",")
    .map((origin) => normalizeOriginValue(origin))
    .filter(Boolean);

// BACKOFFICE_URL lists Back Office origins (comma separated). In production only https origins are
// accepted from it, so a local value such as http://localhost:5174 can never widen production CORS.
const backOfficeOrigins = ({ backofficeUrl = "", nodeEnv = "development" } = {}) =>
  splitOrigins(backofficeUrl).filter((origin) => nodeEnv !== "production" || /^https:\/\//i.test(origin));

const buildAllowedOrigins = ({ frontendUrl = "", backofficeUrl = "", nodeEnv = "development" } = {}) =>
  Array.from(
    new Set([
      ...splitOrigins(frontendUrl),
      ...backOfficeOrigins({ backofficeUrl, nodeEnv }),
      ...PRODUCTION_FRONTEND_ORIGINS.map(normalizeOriginValue)
    ])
  );

const isOriginAllowed = ({ origin, allowedOrigins, nodeEnv = "development" }) => {
  if (allowedOrigins.includes(normalizeOriginValue(origin))) return true;
  return nodeEnv !== "production" && DEV_ORIGIN_PATTERN.test(origin);
};

module.exports = {
  PRODUCTION_FRONTEND_ORIGINS,
  normalizeOriginValue,
  buildAllowedOrigins,
  isOriginAllowed
};
