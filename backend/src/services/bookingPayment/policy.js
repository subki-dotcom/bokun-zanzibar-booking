const { Decimal, toDecimal } = require("../../utils/money");
const { normalizeSalesChannel, SALES_CHANNEL } = require("../../integrations/bokun/salesChannel.adapter");

const OTA_COLLECTORS = Object.freeze({
  [SALES_CHANNEL.GETYOURGUIDE]: "GetYourGuide",
  [SALES_CHANNEL.VIATOR]: "Viator",
  [SALES_CHANNEL.BOKUN_MARKETPLACE]: "Bokun Marketplace"
});

const isConfirmed = (status = "") => String(status).toLowerCase() === "confirmed";
const isBokunPaid = (booking = {}) =>
  booking.bookingPaymentStatusSource === "BOKUN" && booking.bookingPaymentStatus === "PAID";

const resolveGuestPaymentPolicy = ({ booking = {}, total = 0, verifiedPaidAmount = 0 } = {}) => {
  const channel = normalizeSalesChannel(booking.salesChannel || booking.sourceChannel);
  const collector = OTA_COLLECTORS[channel] || "";
  const confirmed = isConfirmed(booking.bookingStatus);
  const localPaid = Decimal.max(0, toDecimal(verifiedPaidAmount));
  const marketplaceConfirmed = channel === SALES_CHANNEL.BOKUN_MARKETPLACE && isBokunPaid(booking);
  const otaPrepaid = confirmed && (channel === SALES_CHANNEL.GETYOURGUIDE || channel === SALES_CHANNEL.VIATOR || marketplaceConfirmed);

  // A verified local receipt for an OTA booking is an accounting exception.
  // Preserve that evidence and leave reconciliation for an authorized review.
  if (otaPrepaid && localPaid.isZero()) {
    return {
      channel,
      collector,
      source: "OTA_CHANNEL",
      amountPaid: Decimal.max(0, toDecimal(total)),
      autoReconciled: true
    };
  }

  return {
    channel,
    collector: "",
    source: "LOCAL_PAYMENT",
    amountPaid: localPaid,
    autoReconciled: false
  };
};

module.exports = { OTA_COLLECTORS, resolveGuestPaymentPolicy };