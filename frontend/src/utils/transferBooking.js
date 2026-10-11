// Pure helpers for the transfer booking form and status page. Prices are never computed here: they come
// from the server's quote, and the server prices the booking again when it is submitted.

export const TRIP_TYPES = Object.freeze({ ONE_WAY: "ONE_WAY", ROUND_TRIP: "ROUND_TRIP" });
export const MAX_PASSENGERS = 99;
// Same rule as the server: letters, digits, one space or hyphen, 2–12 characters, at least one digit.
export const FLIGHT_NUMBER_PATTERN = /^(?=.*\d)[A-Z0-9](?:[A-Z0-9]|[ -](?=[A-Z0-9])){1,11}$/;

export const emptyTransferForm = () => ({
  tripType: TRIP_TYPES.ONE_WAY,
  pickupLocationId: "",
  dropoffLocationId: "",
  travelDate: "",
  travelTime: "",
  returnDate: "",
  returnTime: "",
  adults: 1,
  children: 0,
  infants: 0,
  largeBags: 0,
  smallBags: 0,
  luggageNotes: "",
  flightNumber: "",
  pickupAddress: "",
  dropoffAddress: "",
  fullName: "",
  email: "",
  phone: "",
  whatsapp: true,
  specialRequests: "",
  website: ""
});

// Today's date in Zanzibar (UTC+3), as YYYY-MM-DD, for the date pickers' minimum.
export const zanzibarToday = (now = new Date()) => new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10);

const zanzibarInstant = (date, time) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || "")) return null;
  const instant = new Date(`${date}T${time}:00+03:00`);
  return Number.isNaN(instant.getTime()) ? null : instant;
};

const whole = (value) => Number.isInteger(Number(value)) && Number(value) >= 0;

// The fields needed for a price: available before the customer fills in their details.
export const quoteRequestFor = (form) => {
  if (!form.pickupLocationId || !form.dropoffLocationId || form.pickupLocationId === form.dropoffLocationId) return null;
  const adults = Number(form.adults);
  const children = Number(form.children);
  const infants = Number(form.infants);
  if (!whole(adults) || adults < 1 || !whole(children) || !whole(infants) || adults + children + infants > MAX_PASSENGERS) return null;
  return {
    tripType: form.tripType,
    pickupLocationId: form.pickupLocationId,
    dropoffLocationId: form.dropoffLocationId,
    passengers: { adults, children, infants }
  };
};

export const validateTransferForm = (form, now = new Date()) => {
  const errors = {};
  if (!form.pickupLocationId) errors.pickupLocationId = "Choose a pickup location";
  if (!form.dropoffLocationId) errors.dropoffLocationId = "Choose a drop-off location";
  if (form.pickupLocationId && form.pickupLocationId === form.dropoffLocationId) errors.dropoffLocationId = "Drop-off must differ from pickup";

  const outbound = zanzibarInstant(form.travelDate, form.travelTime);
  if (!outbound) errors.travelDate = "Choose the travel date and time";
  else if (outbound <= now) errors.travelDate = "The travel date and time must be in the future";
  if (form.tripType === TRIP_TYPES.ROUND_TRIP) {
    const back = zanzibarInstant(form.returnDate, form.returnTime);
    if (!back) errors.returnDate = "Choose the return date and time";
    else if (outbound && back <= outbound) errors.returnDate = "The return must be after the outbound transfer";
  }

  const adults = Number(form.adults);
  if (!whole(adults) || adults < 1) errors.adults = "At least one adult";
  if (!whole(form.children)) errors.children = "Enter a whole number";
  if (!whole(form.infants)) errors.infants = "Enter a whole number";
  if (adults + Number(form.children) + Number(form.infants) > MAX_PASSENGERS) errors.adults = `At most ${MAX_PASSENGERS} passengers`;
  if (form.flightNumber && !FLIGHT_NUMBER_PATTERN.test(form.flightNumber.trim().toUpperCase())) errors.flightNumber = "Enter the flight number as shown on your ticket";

  if (String(form.fullName).trim().length < 2) errors.fullName = "Enter your full name";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(form.email).trim())) errors.email = "Enter a valid email address";
  const phoneDigits = String(form.phone).replace(/\D/g, "");
  if (!/^\+?[0-9 ()-]{7,24}$/.test(String(form.phone).trim()) || phoneDigits.length < 7) errors.phone = "Enter a valid phone number with country code";
  return errors;
};

// The booking request. expectedTotal is the price the customer saw (null for "Request a Quote"); the server
// refuses the booking if its own price differs, so a stale or edited price can never be booked.
export const bookingPayloadFor = (form, quote) => {
  const roundTrip = form.tripType === TRIP_TYPES.ROUND_TRIP;
  return {
    tripType: form.tripType,
    pickupLocationId: form.pickupLocationId,
    dropoffLocationId: form.dropoffLocationId,
    travelDate: form.travelDate,
    travelTime: form.travelTime,
    ...(roundTrip ? { returnDate: form.returnDate, returnTime: form.returnTime } : {}),
    passengers: { adults: Number(form.adults), children: Number(form.children), infants: Number(form.infants) },
    luggage: { largeBags: Number(form.largeBags) || 0, smallBags: Number(form.smallBags) || 0, notes: form.luggageNotes.trim() },
    flightNumber: form.flightNumber.trim(),
    pickupAddress: form.pickupAddress.trim(),
    dropoffAddress: form.dropoffAddress.trim(),
    customer: { fullName: form.fullName.trim(), email: form.email.trim(), phone: form.phone.trim(), whatsapp: Boolean(form.whatsapp) },
    specialRequests: form.specialRequests.trim(),
    expectedTotal: quote?.status === "PRICED" ? quote.total : null,
    ...(form.website ? { website: form.website } : {})
  };
};

export const newIdempotencyKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

// The access token travels in the URL fragment (#t=…), which browsers never send to servers or in Referer headers.
export const bookingLink = (reference, accessToken) => `/transfers/booking/${encodeURIComponent(reference)}#t=${encodeURIComponent(accessToken)}`;

export const accessTokenFromHash = (hash = "") => {
  const match = /(?:^#|&)t=([^&]+)/.exec(String(hash));
  return match ? decodeURIComponent(match[1]) : "";
};

export const formatUsd = (amount) => (amount === null || amount === undefined ? "" : `USD ${Number(amount).toFixed(2)}`);

export const STATUS_LABELS = Object.freeze({
  QUOTE_REQUESTED: { label: "Quote requested", tone: "info", next: "Our team will review your request and send you a price. Nothing is charged until you accept it." },
  AWAITING_PAYMENT: { label: "Awaiting payment", tone: "warning", next: "Your transfer is not confirmed yet. It is confirmed once payment has been received and verified." },
  CONFIRMED: { label: "Confirmed", tone: "success", next: "Your transfer is confirmed." },
  CANCELLED: { label: "Cancelled", tone: "secondary", next: "This booking has been cancelled." }
});

export const statusInfo = (status) => STATUS_LABELS[status] || { label: status || "Unknown", tone: "secondary", next: "" };

export const passengerSummary = ({ adults = 0, children = 0, infants = 0 } = {}) =>
  [
    `${adults} adult${adults === 1 ? "" : "s"}`,
    children ? `${children} child${children === 1 ? "" : "ren"}` : "",
    infants ? `${infants} infant${infants === 1 ? "" : "s"}` : ""
  ]
    .filter(Boolean)
    .join(", ");
