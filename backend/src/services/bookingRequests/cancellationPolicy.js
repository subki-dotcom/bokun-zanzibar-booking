const dayjs = require("dayjs");

const getTravelStart = ({ travelDate = "", startTime = "" } = {}) => {
  const time = /^\d{2}:\d{2}/.test(String(startTime || "")) ? startTime : "23:59";
  const parsed = dayjs(`${travelDate}T${time}:00+03:00`);
  return parsed.isValid() ? parsed : null;
};

const calculateCancellationPolicy = ({ booking, amountPaid = undefined, now = dayjs() } = {}) => {
  const travelStart = getTravelStart({ travelDate: booking?.travelDate, startTime: booking?.startTime });
  const amount = Number(amountPaid ?? booking?.invoiceSnapshot?.amountPaid ?? booking?.amount ?? 0);
  const hoursUntilTravel = travelStart ? travelStart.diff(now, "hour", true) : 0;
  let refundPercentage = 0;
  let policyReason = "No refund is available within 24 hours of departure.";

  if (hoursUntilTravel >= 48) {
    refundPercentage = 100;
    policyReason = "Full refund is available when cancelled at least 48 hours before departure.";
  } else if (hoursUntilTravel >= 24) {
    refundPercentage = 50;
    policyReason = "A 50% refund is available between 24 and 48 hours before departure.";
  }

  const estimatedRefundAmount = Number(((amount * refundPercentage) / 100).toFixed(2));
  return {
    eligible: refundPercentage > 0,
    refundPercentage,
    estimatedRefundAmount,
    nonRefundableAmount: Number(Math.max(0, amount - estimatedRefundAmount).toFixed(2)),
    deadline: travelStart?.subtract(48, "hour").toISOString() || null,
    travelStart: travelStart?.toISOString() || null,
    policyReason
  };
};

module.exports = { calculateCancellationPolicy, getTravelStart };
