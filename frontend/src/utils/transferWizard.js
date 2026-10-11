// Step rules for the four-step transfer booking (Trip → Vehicle → Details → Pay). Field checks come from
// validateTransferForm, so each step enforces exactly the rules the server enforces. Nothing here prices a
// trip: every amount shown comes from the server's quote.
import { TRIP_TYPES, composePhone, emptyTransferForm, validateTransferForm } from "./transferBooking.js";

export const STEPS = Object.freeze([
  { id: "trip", label: "Trip", fields: ["pickupLocationId", "dropoffLocationId", "travelDate", "returnDate", "adults", "children", "infants", "largeBags", "smallBags"] },
  { id: "vehicle", label: "Vehicle", fields: ["vehicleOption"] },
  { id: "details", label: "Details", fields: ["fullName", "email", "phone", "flightNumber"] },
  { id: "pay", label: "Pay", fields: [] }
]);

export const stepIndex = (id) => Math.max(0, STEPS.findIndex((step) => step.id === id));

// Until vehicle categories are configured on the server, every priced trip is offered as one private vehicle.
export const PRIVATE_VEHICLE = "PRIVATE_VEHICLE";

const NO_ADDRESS_TYPES = ["AIRPORT", "PORT"];

// Which optional details make sense for the chosen places: a flight number when the trip starts or ends at an
// airport (first when it starts there), and an address for any end that is not an airport or port.
export const detailFieldsFor = (pickupType, dropoffType) => ({
  flight: pickupType === "AIRPORT" || dropoffType === "AIRPORT",
  flightFirst: pickupType === "AIRPORT",
  pickupAddress: !NO_ADDRESS_TYPES.includes(pickupType),
  dropoffAddress: !NO_ADDRESS_TYPES.includes(dropoffType)
});

// The form as it is submitted: details hidden for the chosen places are not sent.
export const relevantForm = (form, fields) => ({
  ...form,
  phone: composePhone(form.phoneCountry, form.phoneNational),
  flightNumber: fields.flight ? form.flightNumber : "",
  pickupAddress: fields.pickupAddress ? form.pickupAddress : "",
  dropoffAddress: fields.dropoffAddress ? form.dropoffAddress : "",
  returnDate: form.tripType === TRIP_TYPES.ROUND_TRIP ? form.returnDate : "",
  returnTime: form.tripType === TRIP_TYPES.ROUND_TRIP ? form.returnTime : ""
});

// The errors that belong to one step. The vehicle step needs a server quote: a priced trip needs the vehicle
// chosen, a trip without a price goes on as a quote request.
export const stepErrors = (index, form, { now = new Date(), maxAdvanceDays, quote } = {}) => {
  if (index === 1) {
    if (!quote) return { vehicleOption: "We are still checking prices for your trip" };
    return quote.status === "PRICED" && form.vehicleOption !== PRIVATE_VEHICLE ? { vehicleOption: "Choose a vehicle to continue" } : {};
  }
  const all = validateTransferForm(form, now, { maxAdvanceDays });
  return Object.fromEntries(Object.entries(all).filter(([field]) => (STEPS[index]?.fields || []).includes(field)));
};

// The furthest step the customer may open: the first step whose rules are not met, or the last step.
// Returns null while the answer depends on a quote that is still loading.
export const furthestStep = (form, { now, maxAdvanceDays, quote, quoteState }) => {
  if (Object.keys(stepErrors(0, form, { now, maxAdvanceDays })).length) return 0;
  if (quoteState === "loading" || quoteState === "idle") return null;
  if (quoteState === "error" || Object.keys(stepErrors(1, form, { quote })).length) return 1;
  if (Object.keys(stepErrors(2, form, { now, maxAdvanceDays })).length) return 2;
  return 3;
};

// The draft is kept for this browser tab only, so a refresh or the Back button never loses what was entered.
// It is removed as soon as the booking is created. The honeypot field is never kept.
export const DRAFT_KEY = "riser_transfer_booking_draft";

const tabStorage = () => {
  try {
    return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null;
  } catch (_error) {
    return null;
  }
};

export const loadDraft = () => {
  try {
    const saved = JSON.parse(tabStorage()?.getItem(DRAFT_KEY) || "null");
    if (!saved || typeof saved !== "object") return null;
    const base = emptyTransferForm();
    const restored = Object.fromEntries(Object.keys(base).map((field) => [field, typeof saved[field] === typeof base[field] ? saved[field] : base[field]]));
    return { ...restored, website: "" };
  } catch (_error) {
    return null;
  }
};

export const saveDraft = (form) => {
  try {
    const { website: _honeypot, ...kept } = form;
    tabStorage()?.setItem(DRAFT_KEY, JSON.stringify(kept));
  } catch (_error) {
    // Storage may be full or blocked; the booking still works without a draft.
  }
};

export const clearDraft = () => {
  try {
    tabStorage()?.removeItem(DRAFT_KEY);
  } catch (_error) {
    // Nothing to clear.
  }
};

// Country calling codes offered in the phone field. A number can also be typed with any "+code".
export const COUNTRY_CODES = Object.freeze([
  ["+255", "Tanzania"], ["+254", "Kenya"], ["+256", "Uganda"], ["+250", "Rwanda"], ["+27", "South Africa"],
  ["+44", "United Kingdom"], ["+1", "United States / Canada"], ["+49", "Germany"], ["+33", "France"], ["+39", "Italy"],
  ["+34", "Spain"], ["+351", "Portugal"], ["+31", "Netherlands"], ["+32", "Belgium"], ["+41", "Switzerland"],
  ["+43", "Austria"], ["+353", "Ireland"], ["+45", "Denmark"], ["+46", "Sweden"], ["+47", "Norway"],
  ["+358", "Finland"], ["+48", "Poland"], ["+420", "Czechia"], ["+36", "Hungary"], ["+40", "Romania"],
  ["+380", "Ukraine"], ["+7", "Russia / Kazakhstan"], ["+90", "Türkiye"], ["+972", "Israel"], ["+20", "Egypt"],
  ["+971", "United Arab Emirates"], ["+966", "Saudi Arabia"], ["+974", "Qatar"], ["+968", "Oman"], ["+91", "India"],
  ["+86", "China"], ["+81", "Japan"], ["+82", "South Korea"], ["+61", "Australia"], ["+64", "New Zealand"],
  ["+55", "Brazil"], ["+234", "Nigeria"]
]);
