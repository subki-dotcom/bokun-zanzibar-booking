const AuditLog = require("../../models/AuditLog");
const logger = require("../../config/logger");

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

const notifyPaymentOrderCreated = ({ booking, provider, requestId }) =>
  recordNotificationEvent({
    booking,
    action: "notification_payment_order_created",
    channel: "payment",
    reason: "Payment order created. Customer should complete hosted checkout.",
    requestId,
    metadata: { provider }
  });

const notifyPaymentVerified = ({ booking, provider, requestId }) =>
  recordNotificationEvent({
    booking,
    action: "notification_payment_verified",
    channel: "payment",
    reason: "Payment verified by payment provider.",
    requestId,
    metadata: { provider }
  });

const notifyBokunPending = ({ booking, provider, requestId, error = "" }) =>
  recordNotificationEvent({
    booking,
    action: "notification_bokun_finalization_pending",
    channel: "ops",
    reason: "Payment verified but Bokun confirmation needs retry or admin attention.",
    requestId,
    metadata: { provider, error }
  });

const notifyPaymentFailed = ({ booking, provider, requestId, reason = "" }) =>
  recordNotificationEvent({
    booking,
    action: "notification_payment_failed",
    channel: "payment",
    reason: reason || "Payment failed or was cancelled.",
    requestId,
    metadata: { provider }
  });

module.exports = {
  notifyPaymentOrderCreated,
  notifyPaymentVerified,
  notifyBokunPending,
  notifyPaymentFailed
};
