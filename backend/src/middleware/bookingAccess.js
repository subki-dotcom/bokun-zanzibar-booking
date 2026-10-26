// Who may read a booking by its reference outside "My booking": staff, the guest's session for that booking, or the
// key from the payment link. Anyone else gets the same 404 as an unknown reference.
const Booking = require("../models/Booking");
const BookingRequest = require("../models/BookingRequest");
const { env } = require("../config/env");
const AppError = require("../utils/AppError");
const { authenticate } = require("./auth");
const { hasPaymentAccess } = require("../services/payments/paymentRecoveryCore");

const STAFF_ROLES = new Set(["super_admin", "admin", "staff", "agent"]);
const notFound = () => new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");

const optionalStaff = (req, res, next) => (req.headers.authorization ? authenticate(req, res, next) : next());

const sameBooking = (session, booking) => Boolean(session && booking && String(session.booking) === String(booking._id));

const requireBookingAccess = (param) => [
  optionalStaff,
  async (req, _res, next) => {
    try {
      if (STAFF_ROLES.has(String(req.auth?.role || ""))) return next();
      const reference = String(req.params?.[param] || "").trim();
      const booking = await Booking.findOne(
        { bookingReference: reference },
        { bookingReference: 1, paymentTransactionId: 1, dpoTransactionToken: 1, "pendingCheckout.pesapalOrderTrackingId": 1, "pendingCheckout.pesapalOrderHistory": 1 }
      ).lean();
      if (!booking) return next(notFound());
      if (sameBooking(req.bookingSession, booking)) return next();
      if (hasPaymentAccess(booking, String(req.query?.key || ""), env.JWT_SECRET)) return next();
      return next(notFound());
    } catch (error) {
      return next(error);
    }
  }
];

// The guest's own booking request only (session for the booking the request belongs to).
const requireOwnBookingRequest = (param) => async (req, _res, next) => {
  try {
    const request = await BookingRequest.findById(String(req.params?.[param] || ""), { booking: 1 }).lean();
    return request && req.bookingSession && String(request.booking) === String(req.bookingSession.booking) ? next() : next(notFound());
  } catch {
    return next(notFound());
  }
};

module.exports = { requireBookingAccess, requireOwnBookingRequest };
