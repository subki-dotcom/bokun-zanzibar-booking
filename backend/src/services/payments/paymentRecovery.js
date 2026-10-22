// Customer payment pages: the payment state of a booking (opened from any browser with the link's key) and a
// payment session for the same booking and amount, reusing the saved one while it is valid.
const Booking = require("../../models/Booking");
const ProductSnapshot = require("../../models/ProductSnapshot");
const logger = require("../../config/logger");
const { env } = require("../../config/env");
const AppError = require("../../utils/AppError");
const bokunService = require("../bokun");
const pesapalService = require("./pesapal");
const dpoService = require("./dpo");
const paypalService = require("./paypal");
const {
  cancellationDeadline,
  currentPesapalSession,
  customerPaymentStatus,
  hasPaymentAccess,
  maskEmail,
  paymentAccessKey,
  travelDatePassed
} = require("./paymentRecoveryCore");

const PROVIDERS = { pesapal: pesapalService, dpo: dpoService, paypal: paypalService };
const PROVIDER_LABELS = { pesapal: "Pesapal", dpo: "DPO", paypal: "PayPal" };
const sessionTtlMinutes = () => Number(process.env.PESAPAL_SESSION_TTL_MINUTES) || undefined;
const secret = () => env.JWT_SECRET;

// The same answer for an unknown reference and a wrong key, so references cannot be probed.
const notFound = () => new AppError("We could not find this booking. Please check your link.", 404, "PAYMENT_LINK_NOT_FOUND");

const loadBooking = async (reference = "", key = "") => {
  const booking = await Booking.findOne({ bookingReference: String(reference || "").trim() });
  if (!booking || !hasPaymentAccess(booking, key, secret())) throw notFound();
  return booking;
};

const tourFor = async (booking) => {
  const product = await ProductSnapshot.findOne(
    { bokunProductId: String(booking.bokunProductId || "") },
    { title: 1, slug: 1, images: 1, duration: 1, liveTourGuide: 1, languages: 1, options: 1 }
  ).lean().catch(() => null);
  const option = (product?.options || []).find((item) => String(item.bokunOptionId) === String(booking.bokunOptionId));
  const languages = (product?.liveTourGuide?.languages?.length ? product.liveTourGuide.languages : product?.languages) || [];
  return {
    title: booking.productTitle || product?.title || "",
    slug: product?.slug || "",
    image: product?.images?.[0] || "",
    option: String(booking.optionTitle || option?.name || "").replace(/^\s*w\/\s*/i, "").trim(),
    duration: product?.duration || "",
    pickup: option ? option.pickupSupported !== false : true,
    language: String(option?.language || (languages.length === 1 ? languages[0] : "")).trim()
  };
};

// Whether the booked trip can still be paid for: not in the past, and the start time still on sale.
const tripAvailability = async (booking, requestId) => {
  if (travelDatePassed(booking)) return { bookable: false, reason: "date_passed" };
  const payload = booking.pendingCheckout?.checkoutPayload || {};
  try {
    const availability = await bokunService.fetchAvailability(
      {
        productId: booking.bokunProductId,
        optionId: booking.bokunOptionId,
        travelDate: booking.travelDate,
        startTime: booking.startTime || "",
        pax: payload.pax || booking.paxSummary || {},
        priceCategoryParticipants: payload.priceCategoryParticipants || booking.priceCategoryParticipants || [],
        extras: [],
        priceCatalogId: payload.priceCatalogId || booking.priceCatalog?.catalogId || ""
      },
      requestId
    );
    const slots = Array.isArray(availability?.slots) ? availability.slots : [];
    const slot = booking.startTime ? slots.find((item) => item.time === booking.startTime) : slots[0];
    const open = availability?.available !== false && slot && !["sold_out", "insufficient_capacity"].includes(slot.status);
    return open ? { bookable: true, reason: "" } : { bookable: false, reason: "unavailable" };
  } catch (error) {
    // A supplier hiccup must not block paying for a held booking; the supplier confirms after payment as before.
    logger.warn("Payment page availability check skipped", { requestId, bookingReference: booking.bookingReference, error: error.message });
    return { bookable: true, reason: "" };
  }
};

const publicStatus = async (booking, { requestId = "", checkTrip = false } = {}) => {
  const status = customerPaymentStatus(booking, { ttlMinutes: sessionTtlMinutes() });
  const session = status === "awaiting_payment" ? currentPesapalSession(booking, { ttlMinutes: sessionTtlMinutes() }) : null;
  const method = String(booking.paymentMethod || "").toLowerCase();
  const pax = booking.paxSummary || {};
  const trip = checkTrip && !["paid", "cancelled"].includes(status) ? await tripAvailability(booking, requestId) : { bookable: true, reason: "" };
  return {
    status,
    bookingReference: booking.bookingReference,
    key: paymentAccessKey(booking, secret()),
    tour: await tourFor(booking),
    date: booking.travelDate || "",
    time: booking.startTime || "",
    travelers: { adults: Number(pax.adults || 0), children: Number(pax.children || 0), infants: Number(pax.infants || 0) },
    amount: Number(booking.amount || booking.pricingSnapshot?.finalPayable || 0),
    currency: booking.currency || booking.pricingSnapshot?.currency || "USD",
    cancellationDeadline: cancellationDeadline(booking),
    paymentMethod: PROVIDER_LABELS[method] || "",
    provider: PROVIDERS[method] ? method : "",
    customerFirstName: String(booking.customer?.firstName || "").trim(),
    maskedEmail: maskEmail(booking.customer?.email),
    pickupHotel: String(booking.customer?.hotelName || "").trim(),
    confirmationCode: status === "paid" ? booking.bokunConfirmationCode || "" : "",
    supplierConfirmed: Boolean(booking.bokunBookingId),
    session: session ? { provider: session.provider, redirectUrl: session.redirectUrl, expiresAt: session.expiresAt } : null,
    trip
  };
};

// Asks the provider about the saved order (Pesapal GetTransactionStatus) so "failed" and "paid" are never guessed.
const recheckWithProvider = async (booking, requestId) => {
  const trackingId = String(booking.pendingCheckout?.pesapalOrderTrackingId || booking.paymentTransactionId || "").trim();
  if (String(booking.paymentMethod || "").toLowerCase() !== "pesapal" || !trackingId) return booking;
  try {
    await pesapalService.verifyAndProcessPesapalPayment({
      orderTrackingId: trackingId,
      orderMerchantReference: booking.pendingCheckout?.pesapalMerchantReference || booking.bookingReference,
      requestId,
      source: "customer_payment_page"
    });
  } catch (error) {
    logger.warn("Payment page provider re-check failed", { requestId, bookingReference: booking.bookingReference, code: error.code || "", error: error.message });
  }
  return (await Booking.findById(booking._id)) || booking;
};

const getPaymentStatus = async ({ reference, key, recheck = false, requestId = "" }) => {
  let booking = await loadBooking(reference, key);
  const before = customerPaymentStatus(booking, { ttlMinutes: sessionTtlMinutes() });
  // "failed" and "processing" are always confirmed with the provider; others only when the guest asks.
  if (recheck || before === "failed" || before === "processing") booking = await recheckWithProvider(booking, requestId);
  return publicStatus(booking, { requestId, checkTrip: true });
};

// A payment session for the booking: the saved Pesapal page while valid, otherwise a new order for the same booking
// and amount (after the provider confirms the old one was not paid). Never creates a booking.
const createPaymentSession = async ({ reference, key, provider = "", requestId = "", checkoutOrigin = "" }) => {
  let booking = await loadBooking(reference, key);
  const wanted = String(provider || booking.paymentMethod || "pesapal").toLowerCase();
  const service = PROVIDERS[wanted];
  if (!service) throw new AppError("This payment method is not available.", 422, "PAYMENT_METHOD_UNAVAILABLE");

  let status = customerPaymentStatus(booking, { ttlMinutes: sessionTtlMinutes() });
  if (status === "paid" || status === "cancelled") return publicStatus(booking, { requestId });

  // Reuse the open Pesapal page: no new order, no second charge.
  const saved = currentPesapalSession(booking, { ttlMinutes: sessionTtlMinutes() });
  if (wanted === "pesapal" && status === "awaiting_payment" && saved && !saved.expired) {
    return publicStatus(booking, { requestId });
  }

  // Before any new order, the provider must say the previous one was not paid (or is still being paid).
  booking = await recheckWithProvider(booking, requestId);
  status = customerPaymentStatus(booking, { ttlMinutes: sessionTtlMinutes() });
  if (["paid", "cancelled", "processing"].includes(status)) return publicStatus(booking, { requestId });

  const trip = await tripAvailability(booking, requestId);
  if (!trip.bookable) {
    throw new AppError(
      trip.reason === "date_passed" ? "This tour date has passed. Please choose a new date." : "This time is no longer available. Please choose a new date.",
      409,
      trip.reason === "date_passed" ? "TRIP_DATE_PASSED" : "TRIP_UNAVAILABLE",
      { reason: trip.reason }
    );
  }

  const result = await service.createPayment({
    payload: {
      bookingId: String(booking._id),
      amount: Number(booking.amount || booking.pricingSnapshot?.finalPayable || 0),
      currency: booking.currency || booking.pricingSnapshot?.currency || "USD",
      paymentMethod: wanted
    },
    auth: null,
    requestId,
    checkoutOrigin
  });
  logger.info("Customer payment session opened", { requestId, bookingReference: booking.bookingReference, provider: wanted });

  const fresh = (await Booking.findById(booking._id)) || booking;
  const view = await publicStatus(fresh, { requestId });
  // Pesapal shows inside the page; DPO and PayPal open their own page.
  return result?.redirectUrl
    ? { ...view, status: "awaiting_payment", session: { provider: wanted, redirectUrl: result.redirectUrl, expiresAt: view.session?.expiresAt || "" } }
    : view;
};

module.exports = { getPaymentStatus, createPaymentSession, paymentAccessKeyFor: (booking) => paymentAccessKey(booking, secret()) };
