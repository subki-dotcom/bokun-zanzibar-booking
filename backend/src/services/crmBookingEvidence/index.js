const Booking = require("../../models/Booking");
const { BOOKING_STATUS } = require("../../config/constants");
const { normalizeBokunBookingStatus } = require("../../integrations/bokun/bookingStatus.adapter");
const AppError = require("../../utils/AppError");

const cleanText = (value = "", maxLength = 240) => String(value || "").trim().slice(0, maxLength);
const idOf = (value) => String(value?._id || value?.id || value || "");
const toPlain = (value) => {
  if (!value) return value;
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};

const executeQuery = async (query) => {
  let next = query;
  if (next && typeof next.lean === "function") next = next.lean();
  return next && typeof next.then === "function" ? next : Promise.resolve(next);
};

const firstText = (...values) => {
  for (const value of values) {
    const text = cleanText(value, 180);
    if (text) return text;
  }
  return "";
};

const normalizeStatus = (value = "") => cleanText(value, 80).toLowerCase();

const extractBokunBookingId = (booking = {}) =>
  firstText(
    booking.bokunBookingId,
    booking.rawBokunResponse?.id,
    booking.rawBokunResponse?.bookingId,
    booking.rawBokunResponse?.booking?.id,
    booking.rawBokunResponse?.booking?.bookingId
  );

const extractBokunConfirmationCode = (booking = {}) =>
  firstText(
    booking.bokunConfirmationCode,
    booking.rawBokunResponse?.confirmationCode,
    booking.rawBokunResponse?.bookingReference,
    booking.rawBokunResponse?.booking?.confirmationCode,
    booking.rawBokunResponse?.booking?.bookingReference
  );

const evaluateBokunConfirmationEvidence = (bookingDoc = {}) => {
  const booking = toPlain(bookingDoc) || {};
  const bokunBookingId = extractBokunBookingId(booking);
  const bokunConfirmationCode = extractBokunConfirmationCode(booking);
  const rawStatusEvidence = normalizeBokunBookingStatus(
    booking.rawBokunResponse || {
      status: booking.bokunStatus?.raw || booking.bokunStatus?.normalized || ""
    }
  );
  const bookingStatus = normalizeStatus(booking.bookingStatus);
  const supplierStatus = normalizeStatus(booking.supplierStatus);
  const bokunStatus = normalizeStatus(booking.bokunStatus?.normalized || rawStatusEvidence.normalizedStatus);
  const hasBokunReference = Boolean(bokunBookingId || bokunConfirmationCode);
  const cancelled =
    bookingStatus === BOOKING_STATUS.CANCELLED ||
    bokunStatus === "cancelled" ||
    rawStatusEvidence.cancelled;
  const confirmedByBokunStatus = rawStatusEvidence.operationallyConfirmed || bokunStatus === "confirmed";
  const confirmedByLocalBokunSync =
    bookingStatus === BOOKING_STATUS.CONFIRMED &&
    (supplierStatus === "confirmed" || booking.operationalSource === "BOKUN");
  const isConfirmed = hasBokunReference && !cancelled && (confirmedByBokunStatus || confirmedByLocalBokunSync);
  const missingEvidence = [];

  if (!hasBokunReference) missingEvidence.push("bokun_booking_id_or_confirmation_code");
  if (cancelled) missingEvidence.push("booking_must_not_be_cancelled");
  if (!confirmedByBokunStatus && !confirmedByLocalBokunSync) {
    missingEvidence.push("confirmed_bokun_status");
  }

  return {
    isConfirmed,
    missingEvidence,
    bookingId: idOf(booking),
    bookingReference: booking.bookingReference || "",
    bokunBookingId,
    bokunConfirmationCode,
    bookingStatus: booking.bookingStatus || "",
    supplierStatus: booking.supplierStatus || "",
    bokunStatus: {
      raw: booking.bokunStatus?.raw || rawStatusEvidence.rawStatus || "",
      normalized: booking.bokunStatus?.normalized || rawStatusEvidence.normalizedStatus || "",
      sourceField: booking.bokunStatus?.sourceField || rawStatusEvidence.sourceField || ""
    },
    operationalSource: booking.operationalSource || "",
    salesChannel: booking.salesChannel || "",
    travelDate: booking.travelDate || booking.bokunOperationalDates?.travelDate?.localDate || "",
    currency: booking.currency || booking.pricingSnapshot?.currency || "USD",
    amount: Number(booking.amount ?? booking.pricingSnapshot?.finalPayable ?? 0) || 0
  };
};

const createCrmBookingEvidenceService = ({ BookingModel = Booking } = {}) => {
  const resolveBooking = async ({ bookingId = "", bookingReference = "", bokunBookingId = "" } = {}) => {
    const normalizedBookingId = cleanText(bookingId, 80);
    const normalizedBookingReference = cleanText(bookingReference, 120);
    const normalizedBokunBookingId = cleanText(bokunBookingId, 180);

    if (normalizedBookingId && typeof BookingModel.findById === "function") {
      return executeQuery(BookingModel.findById(normalizedBookingId));
    }
    if (normalizedBookingReference && typeof BookingModel.findOne === "function") {
      return executeQuery(BookingModel.findOne({ bookingReference: normalizedBookingReference }));
    }
    if (normalizedBokunBookingId && typeof BookingModel.findOne === "function") {
      return executeQuery(BookingModel.findOne({ bokunBookingId: normalizedBokunBookingId }));
    }

    throw new AppError(
      "A booking ID, booking reference, or Bokun booking ID is required for CRM booking conversion.",
      422,
      "CRM_BOOKING_LOOKUP_REQUIRED"
    );
  };

  const resolveConfirmedBookingEvidence = async ({
    bookingId = "",
    bookingReference = "",
    bokunBookingId = ""
  } = {}) => {
    const booking = await resolveBooking({ bookingId, bookingReference, bokunBookingId });
    if (!booking) {
      throw new AppError("Booking not found for CRM conversion.", 404, "CRM_BOOKING_NOT_FOUND");
    }

    const evidence = evaluateBokunConfirmationEvidence(booking);
    const expectedBokunBookingId = cleanText(bokunBookingId, 180);
    if (expectedBokunBookingId && evidence.bokunBookingId && expectedBokunBookingId !== evidence.bokunBookingId) {
      throw new AppError(
        "The supplied Bokun booking ID does not match the canonical booking record.",
        409,
        "CRM_BOOKING_BOKUN_REFERENCE_MISMATCH",
        {
          expectedBokunBookingId,
          actualBokunBookingId: evidence.bokunBookingId,
          bookingReference: evidence.bookingReference
        }
      );
    }

    if (!evidence.isConfirmed) {
      throw new AppError(
        "CRM conversion requires a canonical booking with confirmed Bokun evidence.",
        409,
        "CRM_BOOKING_CONFIRMATION_REQUIRED",
        {
          bookingId: evidence.bookingId,
          bookingReference: evidence.bookingReference,
          bokunBookingId: evidence.bokunBookingId,
          bookingStatus: evidence.bookingStatus,
          supplierStatus: evidence.supplierStatus,
          bokunStatus: evidence.bokunStatus,
          missingEvidence: evidence.missingEvidence
        }
      );
    }

    return {
      booking,
      evidence
    };
  };

  return {
    evaluateBokunConfirmationEvidence,
    resolveConfirmedBookingEvidence
  };
};

const service = createCrmBookingEvidenceService();

module.exports = {
  ...service,
  createCrmBookingEvidenceService,
  __testables: {
    evaluateBokunConfirmationEvidence,
    extractBokunBookingId,
    extractBokunConfirmationCode
  }
};
