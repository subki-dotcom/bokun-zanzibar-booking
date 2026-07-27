const SUCCESS_STATUSES = new Set(["paid", "paid_pending_finalization", "paid_manual_review"]);
const FAILURE_STATUSES = new Set(["failed", "reversed"]);
const CANCELLED_STATUSES = new Set(["cancelled", "canceled"]);

export const PUBLIC_PAYMENT_MESSAGES = {
  PAID: "Payment successful. We are confirming your booking.",
  CONFIRMED: "Payment successful. Your booking is confirmed.",
  FAILED: "Payment unsuccessful. Please try again or use another card.",
  CANCELLED: "Payment was cancelled. You have not been charged.",
  PENDING: "Your payment is being processed. Please wait while we confirm it."
};

const normalize = (value = "") => String(value || "").trim().toLowerCase();

export const buildPaymentResultQuery = ({ orderTrackingId = "", orderMerchantReference = "" } = {}) => {
  const params = new URLSearchParams();
  if (orderTrackingId) {
    params.set("OrderTrackingId", orderTrackingId);
  } else if (orderMerchantReference) {
    params.set("OrderMerchantReference", orderMerchantReference);
  }
  return params.toString();
};

export const resolvePublicPaymentStatus = (result = {}) => {
  const backendStatus = String(result?.publicStatus || "").trim().toUpperCase();
  if (PUBLIC_PAYMENT_MESSAGES[backendStatus]) {
    return backendStatus;
  }

  const status = normalize(result?.status);
  const paymentStatus = normalize(result?.paymentStatus || result?.booking?.paymentStatus);
  const bookingStatus = normalize(result?.bookingStatus || result?.booking?.bookingStatus);
  const hasBokunBooking = Boolean(result?.booking?.bokunBookingId || result?.bokunBookingId);
  const hasVerifiedPaidPayment = Number(result?.amountPaid || result?.booking?.amountPaid || 0) > 0;

  if (bookingStatus === "confirmed" && hasBokunBooking) return "CONFIRMED";
  if (SUCCESS_STATUSES.has(status) || (paymentStatus === "paid" && hasVerifiedPaidPayment)) return "PAID";
  if (CANCELLED_STATUSES.has(status) || bookingStatus === "cancelled") return "CANCELLED";
  if (
    FAILURE_STATUSES.has(status) ||
    ["failed", "reversed"].includes(paymentStatus) ||
    ["failed", "reversed"].includes(bookingStatus)
  ) {
    return "FAILED";
  }

  return "PENDING";
};

export const getPaymentResultPresentation = (result = {}) => {
  const publicStatus = resolvePublicPaymentStatus(result);
  const message = result?.publicMessage || PUBLIC_PAYMENT_MESSAGES[publicStatus] || PUBLIC_PAYMENT_MESSAGES.PENDING;

  const config = {
    CONFIRMED: {
      badge: "Booking confirmed",
      badgeVariant: "success",
      title: "Booking confirmed",
      paymentLabel: "Successful",
      bookingLabel: "Confirmed"
    },
    PAID: {
      badge: "Payment successful",
      badgeVariant: "success",
      title: "Payment successful",
      paymentLabel: "Successful",
      bookingLabel: "Confirming"
    },
    FAILED: {
      badge: "Payment unsuccessful",
      badgeVariant: "danger",
      title: "Payment unsuccessful",
      paymentLabel: "Unsuccessful",
      bookingLabel: "Not created"
    },
    CANCELLED: {
      badge: "Payment cancelled",
      badgeVariant: "secondary",
      title: "Payment cancelled",
      paymentLabel: "Cancelled",
      bookingLabel: "Not created"
    },
    PENDING: {
      badge: "Payment processing",
      badgeVariant: "warning",
      title: "Payment processing",
      paymentLabel: "Processing",
      bookingLabel: "Waiting"
    }
  }[publicStatus];

  return {
    publicStatus,
    message,
    ...config,
    isPaid: ["PAID", "CONFIRMED"].includes(publicStatus),
    isConfirmed: publicStatus === "CONFIRMED",
    isPending: publicStatus === "PENDING" || publicStatus === "PAID",
    isFailed: publicStatus === "FAILED",
    isCancelled: publicStatus === "CANCELLED"
  };
};

export const publicPaymentRefreshError =
  "We could not refresh the payment result yet. Please try again or contact support.";
