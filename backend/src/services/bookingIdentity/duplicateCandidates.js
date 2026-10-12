const { BOOKING_ORIGIN } = require("../../config/constants");
const { resolveBookingOrigin, OPERATIONAL_ORIGINS } = require("../bookings/origin");

// Read-only detection of bookings that may describe the same real booking. It only reports: it never
// merges, deletes, rewrites references, changes revenue or treats a similarity as confirmation.
//
// IDENTITY_CONFLICT: two records carry the same Bókun booking ID or confirmation code.
// ORPHANED_IMPORT:   a Bókun-imported record and a website/Agent Portal record for the same product and
//                    travel date with the same customer, typically because Bókun lost the website's
//                    external reference and the importer could not link them.

const FIELDS =
  "_id bookingReference bookingOrigin createdByRole sourceChannel agentId bokunBookingId bokunConfirmationCode bokunExternalBookingReference bokunProductId travelDate bookingStatus paymentStatus customer.email customer.firstName customer.lastName customer.phone";

const text = (value) => String(value || "").trim();
const lower = (value) => text(value).toLowerCase();
const digits = (value) => text(value).replace(/\D/g, "");
const fullName = (booking) => `${lower(booking.customer?.firstName)} ${lower(booking.customer?.lastName)}`.replace(/\s+/g, " ").trim();

// Report rows identify records by reference only; reviewers open them in the Back Office.
const summary = (booking) => ({
  id: String(booking._id),
  bookingReference: booking.bookingReference || "",
  origin: resolveBookingOrigin(booking).origin,
  bookingStatus: booking.bookingStatus || "",
  paymentStatus: booking.paymentStatus || "",
  travelDate: booking.travelDate || "",
  bokunProductId: booking.bokunProductId || ""
});

const pairKey = (left, right) => [String(left._id), String(right._id)].sort().join(":");

const customerEvidence = (left, right) => {
  const reasons = [];
  const email = lower(left.customer?.email);
  if (email && email === lower(right.customer?.email)) reasons.push("same_customer_email");
  const name = fullName(left);
  const phone = digits(left.customer?.phone);
  if (name && name === fullName(right) && phone.length >= 7 && phone === digits(right.customer?.phone)) {
    reasons.push("same_customer_name_and_phone");
  }
  return reasons;
};

const findDuplicateCandidates = (bookings = []) => {
  const results = new Map();
  const add = (kind, confidence, left, right, reasons) => {
    const key = `${kind}:${pairKey(left, right)}`;
    if (!results.has(key)) results.set(key, { kind, confidence, reasons, records: [summary(left), summary(right)] });
  };

  for (const field of ["bokunBookingId", "bokunConfirmationCode"]) {
    const groups = new Map();
    for (const booking of bookings) {
      const value = text(booking[field]);
      if (!value) continue;
      groups.set(value, [...(groups.get(value) || []), booking]);
    }
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) add("IDENTITY_CONFLICT", "high", group[i], group[j], [`same_${field}`]);
      }
    }
  }

  const byTrip = new Map();
  for (const booking of bookings) {
    const trip = `${text(booking.bokunProductId)}|${text(booking.travelDate)}`;
    if (trip === "|") continue;
    byTrip.set(trip, [...(byTrip.get(trip) || []), booking]);
  }
  for (const group of byTrip.values()) {
    const imported = group.filter((booking) => resolveBookingOrigin(booking).origin === BOOKING_ORIGIN.BOKUN_IMPORT);
    const operational = group.filter((booking) => OPERATIONAL_ORIGINS.includes(resolveBookingOrigin(booking).origin));
    for (const importedBooking of imported) {
      for (const operationalBooking of operational) {
        // Already linked through the website reference: the importer would have matched these.
        if (text(importedBooking.bokunExternalBookingReference) === text(operationalBooking.bookingReference)) continue;
        const reasons = customerEvidence(importedBooking, operationalBooking);
        if (!reasons.length) continue;
        add(
          "ORPHANED_IMPORT",
          reasons.includes("same_customer_email") ? "probable" : "possible",
          operationalBooking,
          importedBooking,
          ["same_product_and_travel_date", ...reasons]
        );
      }
    }
  }
  return [...results.values()];
};

module.exports = { FIELDS, findDuplicateCandidates };
