const { BOOKING_STATUS } = require("../../config/constants");

const STATUS_FIELD_CANDIDATES = [
  "booking.status",
  "status",
  "bookingStatus",
  "state",
  "booking.state",
  "booking.bookingStatus"
];

const getPath = (target, path) =>
  path.split(".").reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), target);

const normalizeToken = (value = "") => String(value || "").trim();

const extractRawBookingStatus = (raw = {}) => {
  const root = raw?.raw || raw || {};

  for (const path of STATUS_FIELD_CANDIDATES) {
    const value = getPath(root, path);
    const token = normalizeToken(value);
    if (token) {
      return {
        rawStatus: token,
        sourceField: path
      };
    }
  }

  return {
    rawStatus: "",
    sourceField: ""
  };
};

const normalizeBokunBookingStatus = (raw = {}) => {
  const { rawStatus, sourceField } = extractRawBookingStatus(raw);
  const token = rawStatus.toUpperCase();

  if (!token) {
    return {
      rawStatus,
      normalizedStatus: "unknown",
      localBookingStatus: BOOKING_STATUS.PENDING,
      sourceField,
      operationallyConfirmed: false,
      cancelled: false,
      known: false
    };
  }

  if (token === "CONFIRMED") {
    return {
      rawStatus,
      normalizedStatus: "confirmed",
      localBookingStatus: BOOKING_STATUS.CONFIRMED,
      sourceField,
      operationallyConfirmed: true,
      cancelled: false,
      known: true
    };
  }

  if (["CANCELLED", "CANCELED", "VOIDED"].includes(token)) {
    return {
      rawStatus,
      normalizedStatus: "cancelled",
      localBookingStatus: BOOKING_STATUS.CANCELLED,
      sourceField,
      operationallyConfirmed: false,
      cancelled: true,
      known: true
    };
  }

  if (["REJECTED", "TIMEOUT"].includes(token)) {
    return {
      rawStatus,
      normalizedStatus: token.toLowerCase(),
      localBookingStatus: BOOKING_STATUS.FAILED,
      sourceField,
      operationallyConfirmed: false,
      cancelled: false,
      known: true
    };
  }

  if (["RESERVED", "PENDING"].includes(token)) {
    return {
      rawStatus,
      normalizedStatus: "pending",
      localBookingStatus: BOOKING_STATUS.PENDING,
      sourceField,
      operationallyConfirmed: false,
      cancelled: false,
      known: true
    };
  }

  return {
    rawStatus,
    normalizedStatus: "unknown",
    localBookingStatus: BOOKING_STATUS.PENDING,
    sourceField,
    operationallyConfirmed: false,
    cancelled: false,
    known: false
  };
};

module.exports = {
  extractRawBookingStatus,
  normalizeBokunBookingStatus
};
