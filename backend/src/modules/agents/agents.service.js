const Agent = require("../../models/Agent");
const Booking = require("../../models/Booking");
const CommissionRecord = require("../../models/CommissionRecord");
const AppError = require("../../utils/AppError");
const mongoose = require("mongoose");

const createAgent = async (payload) => {
  const exists = await Agent.findOne({ email: payload.email.toLowerCase() });

  if (exists) {
    throw new AppError("Agent email already exists", 409, "AGENT_EMAIL_EXISTS");
  }

  const agent = await Agent.create({
    companyName: payload.companyName,
    contactFirstName: payload.contactFirstName,
    contactLastName: payload.contactLastName,
    email: payload.email.toLowerCase(),
    password: payload.password,
    phone: payload.phone || "",
    country: payload.country || "",
    commissionPercent: payload.commissionPercent || null,
    productCommissionOverrides: payload.productCommissionOverrides || [],
    optionCommissionOverrides: payload.optionCommissionOverrides || [],
    notes: payload.notes || ""
  });

  return agent.toObject();
};

const listAgents = async () => {
  return Agent.find({}).select("-password").sort({ createdAt: -1 }).lean();
};

const getAgentDashboard = async (agentId) => {
  const agentObjectId = new mongoose.Types.ObjectId(agentId);

  const [bookings, commissions, commissionSummary] = await Promise.all([
    Booking.find({ agentId })
      .select("bookingReference productTitle travelDate bookingStatus paymentStatus pricingSnapshot createdAt")
      .sort({ createdAt: -1 })
      .limit(30)
      .lean(),
    CommissionRecord.find({ agentId }).sort({ createdAt: -1 }).limit(30).lean(),
    CommissionRecord.aggregate([
      { $match: { agentId: agentObjectId } },
      {
        $group: {
          _id: "$payoutStatus",
          totalAmount: { $sum: "$commissionAmount" },
          totalCount: { $sum: 1 }
        }
      }
    ])
  ]);

  return {
    bookings,
    commissions,
    commissionSummary
  };
};

const getAgentMonthlyStatement = async (agentId, payoutMonth) => {
  const records = await CommissionRecord.find({ agentId, payoutMonth }).lean();

  const totalCommission = records.reduce((sum, row) => sum + Number(row.commissionAmount || 0), 0);
  const totalNet = records.reduce((sum, row) => sum + Number(row.netAmount || 0), 0);

  return {
    payoutMonth,
    totalCommission,
    totalNet,
    records
  };
};

module.exports = {
  createAgent,
  listAgents,
  getAgentDashboard,
  getAgentMonthlyStatement
};
