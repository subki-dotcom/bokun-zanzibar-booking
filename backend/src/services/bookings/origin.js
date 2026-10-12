const { BOOKING_ORIGIN } = require("../../config/constants");

// Booking origin answers "where did this booking enter the system?". It is recorded once when the
// booking is created and synchronization never changes it. For bookings created before the field
// existed, origin is derived from evidence written at creation time, and only when that evidence is
// unambiguous. Anything else is UNKNOWN and needs review.
//
// Deliberately NOT used as evidence:
// - operationalSource: it flips to BOKUN whenever Bókun evidence exists, website bookings included.
// - salesChannel / bokunBookingId / supplier status: they describe who sold it and its supplier state.
const UNKNOWN_ORIGIN = "UNKNOWN";
const KNOWN_ORIGINS = Object.values(BOOKING_ORIGIN);
const OPERATIONAL_ORIGINS = [BOOKING_ORIGIN.WEBSITE, BOOKING_ORIGIN.AGENT_PORTAL];

// Website and Agent Portal checkouts generate ZNZ-<epoch ms>-<4 digits>; Bókun references never do.
const WEBSITE_REFERENCE_PATTERN = /^ZNZ-\d{13}-\d{4}$/;
const WEBSITE_REFERENCE_SOURCE = "^ZNZ-\\d{13}-\\d{4}$";

// Checkout source contexts (resolveSourceContext) and the origin they create.
const originForSourceContext = (sourceContext = {}) =>
  sourceContext.sourceChannel === "agent_portal" ? BOOKING_ORIGIN.AGENT_PORTAL : BOOKING_ORIGIN.WEBSITE;

// Historical evidence rules. Each is a creation-time fact only one creation path writes.
const HISTORICAL_RULES = [
  {
    origin: BOOKING_ORIGIN.BOKUN_IMPORT,
    // The importer stamps this only on bookings it creates; matched bookings keep their creator.
    matches: (booking) => booking.createdByRole === "bokun_import",
    query: { createdByRole: "bokun_import" }
  },
  {
    origin: BOOKING_ORIGIN.AGENT_PORTAL,
    matches: (booking) =>
      booking.createdByRole === "agent" &&
      booking.sourceChannel === "agent_portal" &&
      Boolean(booking.agentId) &&
      WEBSITE_REFERENCE_PATTERN.test(String(booking.bookingReference || "")),
    query: {
      createdByRole: "agent",
      sourceChannel: "agent_portal",
      agentId: { $ne: null },
      bookingReference: { $regex: WEBSITE_REFERENCE_SOURCE }
    }
  },
  {
    origin: BOOKING_ORIGIN.WEBSITE,
    // Guest checkout (including Agent referral links) and verified-payment recovery of a guest checkout.
    matches: (booking) =>
      ["customer", "payment_recovery"].includes(booking.createdByRole) &&
      ["direct_website", "agent_referral"].includes(booking.sourceChannel) &&
      WEBSITE_REFERENCE_PATTERN.test(String(booking.bookingReference || "")),
    query: {
      createdByRole: { $in: ["customer", "payment_recovery"] },
      sourceChannel: { $in: ["direct_website", "agent_referral"] },
      bookingReference: { $regex: WEBSITE_REFERENCE_SOURCE }
    }
  }
];

const hasRecordedOrigin = (booking = {}) => KNOWN_ORIGINS.includes(booking.bookingOrigin);

// { origin, basis }: basis is "recorded", "historical" (derived) or "unresolved" (review required).
const resolveBookingOrigin = (booking = {}) => {
  if (hasRecordedOrigin(booking)) return { origin: booking.bookingOrigin, basis: "recorded" };
  const rule = HISTORICAL_RULES.find((candidate) => candidate.matches(booking));
  return rule ? { origin: rule.origin, basis: "historical" } : { origin: UNKNOWN_ORIGIN, basis: "unresolved" };
};

// Mongo filter selecting exactly the bookings resolveBookingOrigin assigns to one of `origins`.
const originFilter = (origins = []) => {
  const wanted = origins.filter((origin) => KNOWN_ORIGINS.includes(origin));
  const recorded = { bookingOrigin: { $in: wanted } };
  // Historical rules apply only when no origin is recorded, and in priority order: a booking matching
  // an earlier rule must not be selected by a later one.
  const unrecorded = { bookingOrigin: { $nin: KNOWN_ORIGINS } };
  const branches = [];
  HISTORICAL_RULES.forEach((rule, index) => {
    if (!wanted.includes(rule.origin)) return;
    const earlier = HISTORICAL_RULES.slice(0, index).map((previous) => ({ $nor: [previous.query] }));
    branches.push({ $and: [unrecorded, rule.query, ...earlier] });
  });
  return { $or: [recorded, ...branches] };
};

module.exports = {
  UNKNOWN_ORIGIN,
  KNOWN_ORIGINS,
  OPERATIONAL_ORIGINS,
  WEBSITE_REFERENCE_PATTERN,
  originForSourceContext,
  resolveBookingOrigin,
  originFilter
};
