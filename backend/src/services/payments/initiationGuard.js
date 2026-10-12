const { v4: uuidv4 } = require("uuid");
const Booking = require("../../models/Booking");
const payments = require("./index");
const AppError = require("../../utils/AppError");
const { isSupplierBookingConfirmed } = require("../../integrations/bokun/bookingStatus.adapter");
const UNPAID = ["pending", "initiated", "processing", "failed", "verification_error"];
const paidResponse = (booking) => ({
  bookingId: booking._id, bookingReference: booking.bookingReference, redirectUrl: "",
  paymentStatus: "paid", bookingStatus: booking.bookingStatus,
  message: isSupplierBookingConfirmed(booking) ? "Booking already paid and confirmed"
    : "Payment already verified. Supplier confirmation is still pending."
});
const conflict = () => new AppError("An existing payment attempt requires reconciliation before another can be opened", 409, "PAYMENT_INITIATION_REQUIRES_REVIEW");
const claim = async ({ booking, provider }) => {
  const latest = await Booking.findById(booking._id);
  if (latest.paymentStatus === "paid") return { response: paidResponse(latest) };
  const payment = await payments.findLatestPaymentByBookingReference({ bookingReference: latest.bookingReference });
  // Adjustments require their explicit refund, reversal or dispute workflows.
  if (latest.bookingStatus === "cancelled" || !UNPAID.includes(latest.paymentStatus) ||
      /refund|revers|disput|chargeback/i.test([payment?.status, payment?.paymentStatus, payment?.providerStatus].join(" "))) throw conflict();
  if (payment?.status === "paid") return { response: paidResponse(latest) };
  const previous = latest.paymentInitiation;
  if (previous && latest.paymentStatus !== "failed") {
    if (previous.status === "created" && previous.provider === provider && previous.response) return { response: previous.response };
    throw conflict();
  }
  // Lost or ambiguous submissions are never replayed automatically.
  if (previous && previous.status !== "created") throw conflict();
  if (!previous && latest.paymentStatus !== "failed" && (latest.paymentTransactionId || latest.dpoTransactionToken)) throw conflict();
  const token = uuidv4();
  const owned = await Booking.findOneAndUpdate({
    _id: latest._id, paymentStatus: latest.paymentStatus,
    ...(previous ? { "paymentInitiation.token": previous.token } : { paymentInitiation: { $exists: false } })
  }, { $set: { paymentInitiation: { token, provider, status: "submitting", startedAt: new Date(), amount: latest.amount, currency: latest.currency } } }, { new: true });
  if (!owned) {
    const current = await Booking.findById(latest._id);
    if (current?.paymentStatus === "paid") return { response: paidResponse(current) };
    throw conflict();
  }
  return { booking: owned, token };
};
const persist = async ({ booking, token, fields, checkout, response }) => {
  const patch = { ...fields };
  for (const [key, value] of Object.entries(checkout)) patch["pendingCheckout." + key] = value;
  patch["paymentInitiation.response"] = response;
  const saved = await Booking.findOneAndUpdate({
    _id: booking._id, "paymentInitiation.token": token,
    paymentStatus: { $in: UNPAID }, bookingStatus: booking.bookingStatus, amount: booking.amount, currency: booking.currency
  }, { $set: patch, $inc: { __v: 1 } }, { new: true, runValidators: true });
  if (saved) return { booking: saved };
  await Booking.updateOne({ _id: booking._id, "paymentInitiation.token": token }, {
    $set: { "paymentInitiation.response": response, "paymentInitiation.status": "unknown" }
  });
  const latest = await Booking.findById(booking._id);
  if (latest?.paymentStatus === "paid") return { response: paidResponse(latest) };
  throw conflict();
};
const complete = async ({ booking, token, response }) => {
  const saved = await Booking.findOneAndUpdate({
    _id: booking._id, "paymentInitiation.token": token, paymentStatus: { $in: UNPAID }
  }, { $set: { "paymentInitiation.status": "created" } }, { new: true });
  if (saved) return response;
  const latest = await Booking.findById(booking._id);
  if (latest?.paymentStatus === "paid") return paidResponse(latest);
  throw conflict();
};
module.exports = { claim, persist, complete, paidResponse };
