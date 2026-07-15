const AuditLog = require("../../models/AuditLog");
const logger = require("../../config/logger");
const emailService = require("../email");

const recordNotificationEvent = async ({
  booking,
  action,
  channel = "system",
  reason = "",
  requestId = "",
  metadata = {}
}) => {
  if (!booking || !action) {
    return null;
  }

  logger.info("Notification event recorded", {
    action,
    channel,
    bookingReference: booking.bookingReference,
    requestId,
    metadata
  });

  return AuditLog.create({
    actorId: null,
    actorRole: "system",
    action,
    entityType: "Booking",
    entityId: booking._id?.toString?.() || String(booking.bookingId || ""),
    reason,
    requestId,
    after: {
      bookingReference: booking.bookingReference,
      paymentStatus: booking.paymentStatus,
      bookingStatus: booking.bookingStatus,
      customerEmail: booking.customer?.email || "",
      customerPhone: booking.customer?.phone || ""
    },
    metadata: {
      channel,
      ...metadata
    }
  });
};

const notifyWithEmail = async ({ booking, provider, requestId, action, channel, reason, templateKey, metadata = {} }) => {
  const audit = await recordNotificationEvent({
    booking,
    action,
    channel,
    reason,
    requestId,
    metadata: { provider, ...metadata }
  });
  const delivery = templateKey ? await emailService.sendBookingEmailOnce({ booking, templateKey, requestId }) : null;
  return { audit, delivery };
};

const notifyPaymentOrderCreated = ({ booking, provider, requestId }) =>
  notifyWithEmail({
    booking,
    provider,
    requestId,
    action: "notification_payment_order_created",
    channel: "payment",
    reason: "Payment order created. Customer should complete hosted checkout.",
    templateKey: "payment_checkout"
  });

const notifyPaymentVerified = ({ booking, provider, requestId }) =>
  notifyWithEmail({
    booking,
    provider,
    action: "notification_payment_verified",
    channel: "payment",
    reason: "Payment verified by payment provider.",
    requestId,
    templateKey: booking?.bokunBookingId ? null : "payment_paid"
  });

const notifyBokunPending = ({ booking, provider, requestId, error = "" }) =>
  notifyWithEmail({
    booking,
    provider,
    action: "notification_bokun_finalization_pending",
    channel: "ops",
    reason: "Payment verified but Bokun confirmation needs retry or admin attention.",
    requestId,
    templateKey: "supplier_confirmation_pending",
    metadata: { error }
  });

const notifyPaymentFailed = ({ booking, provider, requestId, reason = "" }) =>
  notifyWithEmail({
    booking,
    provider,
    action: "notification_payment_failed",
    channel: "payment",
    reason: reason || "Payment failed or was cancelled.",
    requestId,
    templateKey: "payment_failed"
  });

const notifyBookingConfirmed = ({ booking, provider, requestId }) =>
  notifyWithEmail({
    booking,
    provider,
    requestId,
    action: "notification_booking_confirmed",
    channel: "booking",
    reason: "Payment and Bokun supplier confirmation completed.",
    templateKey: "booking_confirmed"
  });

module.exports = {
  notifyPaymentOrderCreated,
  notifyPaymentVerified,
  notifyBokunPending,
  notifyPaymentFailed,
  notifyBookingConfirmed
};
