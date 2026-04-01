const dayjs = require("dayjs");
const Agent = require("../../models/Agent");
const CommissionRecord = require("../../models/CommissionRecord");
const { env } = require("../../config/env");

const resolveCommissionPercent = ({ agent, productId, optionId, manualOverridePercent }) => {
  if (manualOverridePercent !== null && manualOverridePercent !== undefined) {
    return { percent: manualOverridePercent, source: "booking" };
  }

  const optionOverride = (agent.optionCommissionOverrides || []).find((item) => item.bokunOptionId === optionId);
  if (optionOverride) {
    return { percent: optionOverride.percent, source: "option" };
  }

  const productOverride = (agent.productCommissionOverrides || []).find((item) => item.bokunProductId === productId);
  if (productOverride) {
    return { percent: productOverride.percent, source: "product" };
  }

  if (agent.commissionPercent !== null && agent.commissionPercent !== undefined) {
    return { percent: agent.commissionPercent, source: "agent" };
  }

  return { percent: env.GLOBAL_AGENT_COMMISSION_PERCENT, source: "global" };
};

const createCommissionForBooking = async ({
  booking,
  agentId,
  manualOverridePercent = null,
  notes = ""
}) => {
  if (!agentId) {
    return null;
  }

  const agent = await Agent.findById(agentId).lean();
  if (!agent) {
    return null;
  }

  const { percent, source } = resolveCommissionPercent({
    agent,
    productId: booking.bokunProductId,
    optionId: booking.bokunOptionId,
    manualOverridePercent
  });

  const grossAmount = Number(booking.pricingSnapshot?.grossAmount || 0);
  const discountAmount = Number(booking.pricingSnapshot?.discountAmount || 0);
  const netAmount = Math.max(0, grossAmount - discountAmount);
  const commissionAmount = Number(((netAmount * percent) / 100).toFixed(2));

  return CommissionRecord.create({
    bookingReference: booking.bookingReference,
    agentId,
    bokunProductId: booking.bokunProductId,
    bokunOptionId: booking.bokunOptionId,
    grossAmount,
    netAmount,
    commissionPercent: percent,
    commissionAmount,
    payoutStatus: "unpaid",
    payoutMonth: dayjs(booking.createdAt || new Date()).format("YYYY-MM"),
    notes,
    sourceOverride: source
  });
};

const listCommissionSummary = async () => {
  const grouped = await CommissionRecord.aggregate([
    {
      $group: {
        _id: "$payoutStatus",
        totalAmount: { $sum: "$commissionAmount" },
        totalRecords: { $sum: 1 }
      }
    }
  ]);

  return grouped;
};

module.exports = {
  createCommissionForBooking,
  listCommissionSummary
};