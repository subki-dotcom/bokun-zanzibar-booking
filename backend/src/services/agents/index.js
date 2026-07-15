const Agent = require("../../models/Agent");
const Booking = require("../../models/Booking");
const CommissionRecord = require("../../models/CommissionRecord");
const AuditLog = require("../../models/AuditLog");
const AgentPayoutRequest = require("../../models/AgentPayoutRequest");
const AppError = require("../../utils/AppError");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { env } = require("../../config/env");

const money = (value = 0) => Number(Number(value || 0).toFixed(2));

const createReferralCode = (companyName = "") => {
  const prefix = String(companyName || "RISER")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 8) || "RISER";
  return `${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
};

const ensureReferralCode = async (agent) => {
  if (agent?.referralCode) return agent;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    agent.referralCode = createReferralCode(agent.companyName);
    try {
      await agent.save();
      return agent;
    } catch (error) {
      if (error?.code !== 11000 || attempt === 4) throw error;
    }
  }

  return agent;
};

const maskAccount = (value = "") => {
  const text = String(value || "").trim();
  if (text.length <= 4) {
    return text ? "****" : "";
  }

  return `${"*".repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
};

const buildAgentPublicProfile = (agent = {}) => ({
  id: agent._id,
  companyName: agent.companyName,
  contactFirstName: agent.contactFirstName,
  contactLastName: agent.contactLastName,
  fullName: agent.fullName,
  email: agent.email,
  phone: agent.phone,
  country: agent.country,
  address: agent.address || "",
  agentType: agent.agentType || "partner",
  profilePhotoUrl: agent.profilePhotoUrl || "",
  commissionPercent: agent.commissionPercent,
  accountStatus: agent.isActive ? "active" : "suspended",
  approvalStatus: agent.approvalStatus || "approved",
  termsAcceptedAt: agent.termsAcceptedAt || null,
  termsVersion: agent.termsVersion || "",
  referralCode: agent.referralCode || "",
  referralUrl: agent.referralCode ? `${String(env.FRONTEND_URL || "").replace(/\/$/, "")}/?ref=${encodeURIComponent(agent.referralCode)}` : "",
  joinedAt: agent.createdAt
});

const bookingSelect =
  "bookingReference bokunBookingId productTitle optionTitle travelDate startTime bookingStatus paymentStatus pricingSnapshot paxSummary customer sourceChannel createdAt currency amount";

const ensureOwnBooking = async (agentId, referenceOrId) => {
  const query = mongoose.Types.ObjectId.isValid(referenceOrId)
    ? { _id: referenceOrId, agentId }
    : { bookingReference: referenceOrId, agentId };
  const booking = await Booking.findOne(query).lean();

  if (!booking) {
    throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  return booking;
};

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
    address: payload.address || "",
    agentType: payload.agentType || "partner",
    commissionPercent: payload.commissionPercent || null,
    productCommissionOverrides: payload.productCommissionOverrides || [],
    optionCommissionOverrides: payload.optionCommissionOverrides || [],
    notes: payload.notes || "",
    referralCode: createReferralCode(payload.companyName)
  });

  return agent.toObject();
};

const listAgents = async () => {
  return Agent.find({}).select("-password").sort({ createdAt: -1 }).lean();
};

const getAgentDashboard = async (agentId) => {
  const agentObjectId = new mongoose.Types.ObjectId(agentId);
  const today = new Date().toISOString().slice(0, 10);
  const agent = await ensureReferralCode(await Agent.findById(agentId));
  if (!agent) throw new AppError("Agent not found", 404, "AGENT_NOT_FOUND");

  const [bookings, commissions, commissionSummary, todayBookings] = await Promise.all([
    Booking.find({ agentId })
      .select(bookingSelect)
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
    ]),
    Booking.countDocuments({ agentId, createdAt: { $gte: new Date(`${today}T00:00:00.000Z`) } })
  ]);

  const totals = bookings.reduce(
    (summary, booking) => {
      const amount = Number(booking.pricingSnapshot?.finalPayable || booking.amount || 0);
      summary.totalSales += amount;
      summary.pendingBookings += booking.bookingStatus === "pending" ? 1 : 0;
      summary.confirmedBookings += booking.bookingStatus === "confirmed" ? 1 : 0;
      summary.cancelledBookings += booking.bookingStatus === "cancelled" ? 1 : 0;
      return summary;
    },
    {
      todayBookings,
      pendingBookings: 0,
      confirmedBookings: 0,
      cancelledBookings: 0,
      totalSales: 0
    }
  );
  const totalCommission = commissions.reduce((sum, row) => sum + Number(row.commissionAmount || 0), 0);
  const unpaidCommission = commissions
    .filter((row) => row.payoutStatus !== "paid")
    .reduce((sum, row) => sum + Number(row.commissionAmount || 0), 0);

  return {
    agent: buildAgentPublicProfile(agent.toObject()),
    agentName: agent.fullName,
    summary: {
      ...totals,
      totalSales: money(totals.totalSales),
      totalCommission: money(totalCommission),
      unpaidCommission: money(unpaidCommission)
    },
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

const listAgentBookings = async (agentId, filters = {}) => {
  const query = { agentId };
  const search = String(filters.search || "").trim();

  if (filters.bookingStatus) {
    query.bookingStatus = filters.bookingStatus;
  }
  if (filters.paymentStatus) {
    query.paymentStatus = filters.paymentStatus;
  }
  if (filters.travelDate) {
    query.travelDate = filters.travelDate;
  }

  const bookings = await Booking.find(query).select(bookingSelect).sort({ createdAt: -1 }).limit(200).lean();
  if (!search) {
    return bookings;
  }

  const token = search.toLowerCase();
  return bookings.filter((booking) =>
    [
      booking.bookingReference,
      booking.productTitle,
      booking.optionTitle,
      booking.customer?.firstName,
      booking.customer?.lastName,
      booking.customer?.email,
      booking.customer?.phone
    ]
      .map((value) => String(value || "").toLowerCase())
      .some((value) => value.includes(token))
  );
};

const getAgentBookingDetails = async (agentId, referenceOrId) => {
  const booking = await ensureOwnBooking(agentId, referenceOrId);
  const commission = await CommissionRecord.findOne({
    agentId,
    bookingReference: booking.bookingReference
  }).lean();

  return {
    booking,
    commission
  };
};

const getAgentVoucher = async (agentId, referenceOrId) => {
  const { booking } = await getAgentBookingDetails(agentId, referenceOrId);

  return {
    bookingReference: booking.bookingReference,
    bokunBookingId: booking.bokunBookingId || "",
    customerName: `${booking.customer?.firstName || ""} ${booking.customer?.lastName || ""}`.trim(),
    tourName: booking.productTitle,
    selectedOption: booking.optionTitle,
    date: booking.travelDate,
    time: booking.startTime || "",
    pickupLocation: booking.customer?.hotelName || booking.invoiceSnapshot?.pickupLocation || "",
    pax: booking.paxSummary || {},
    inclusions: booking.invoiceSnapshot?.included || [],
    importantNotes: booking.invoiceSnapshot?.importantInformation || [],
    emergencyContact: "+255 778 775 044",
    paymentStatus: booking.paymentStatus,
    bookingStatus: booking.bookingStatus
  };
};

const resendAgentVoucher = async (agentId, referenceOrId, requestId = "") => {
  const voucher = await getAgentVoucher(agentId, referenceOrId);
  const booking = await ensureOwnBooking(agentId, referenceOrId);
  const voucherUrl = `/agent/bookings/${booking.bookingReference}/voucher`;
  const message = `Riser Tours & Safaris voucher ${booking.bookingReference}: ${booking.productTitle} on ${booking.travelDate}. Voucher: ${voucherUrl}`;

  await AuditLog.create({
    actorId: String(agentId),
    actorRole: "agent",
    action: "agent_voucher_resend_requested",
    entityType: "Booking",
    entityId: booking._id.toString(),
    reason: "Agent requested voucher resend/share",
    requestId,
    after: {
      bookingReference: booking.bookingReference,
      customerEmail: booking.customer?.email || "",
      customerPhone: booking.customer?.phone || ""
    },
    metadata: {
      voucherUrl
    }
  });

  return {
    ...voucher,
    voucherUrl,
    emailTo: booking.customer?.email || "",
    whatsappTo: booking.customer?.phone || "",
    mailtoUrl: booking.customer?.email
      ? `mailto:${encodeURIComponent(booking.customer.email)}?subject=${encodeURIComponent(`Tour voucher ${booking.bookingReference}`)}&body=${encodeURIComponent(message)}`
      : "",
    whatsappUrl: `https://wa.me/?text=${encodeURIComponent(message)}`
  };
};

const getAgentCommissions = async (agentId) => {
  const records = await CommissionRecord.find({ agentId }).sort({ createdAt: -1 }).lean();
  const summary = records.reduce(
    (acc, row) => {
      acc.totalBookings += 1;
      acc.totalSales += Number(row.netAmount || 0);
      acc.totalCommission += Number(row.commissionAmount || 0);
      if (row.payoutStatus === "paid") {
        acc.paidCommission += Number(row.commissionAmount || 0);
      } else {
        acc.unpaidCommission += Number(row.commissionAmount || 0);
      }
      if (row.payoutMonth === new Date().toISOString().slice(0, 7)) {
        acc.currentMonthCommission += Number(row.commissionAmount || 0);
      }
      return acc;
    },
    {
      totalBookings: 0,
      totalSales: 0,
      totalCommission: 0,
      paidCommission: 0,
      unpaidCommission: 0,
      currentMonthCommission: 0
    }
  );

  const statementMap = new Map();
  records.forEach((row) => {
    const month = row.payoutMonth || "unknown";
    const current = statementMap.get(month) || {
      month,
      bookingCount: 0,
      totalSales: 0,
      totalCommission: 0,
      paidAmount: 0,
      balance: 0,
      status: "pending"
    };
    current.bookingCount += 1;
    current.totalSales += Number(row.netAmount || 0);
    current.totalCommission += Number(row.commissionAmount || 0);
    if (row.payoutStatus === "paid") {
      current.paidAmount += Number(row.commissionAmount || 0);
    }
    current.balance = Math.max(0, current.totalCommission - current.paidAmount);
    current.status = current.balance <= 0 ? "paid" : "pending";
    statementMap.set(month, current);
  });

  return {
    summary: Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, money(value)])),
    statements: Array.from(statementMap.values()).map((row) => ({
      ...row,
      totalSales: money(row.totalSales),
      totalCommission: money(row.totalCommission),
      paidAmount: money(row.paidAmount),
      balance: money(row.balance)
    })),
    records
  };
};

const listPayoutRequests = async (agentId) => {
  return AgentPayoutRequest.find({ agentId }).sort({ createdAt: -1 }).limit(100).lean();
};

const requestPayout = async (agentId, payload = {}) => {
  const commissions = await getAgentCommissions(agentId);
  const unpaidAmount = Number(commissions?.summary?.unpaidCommission || 0);
  const requestedAmount = payload.amount ? Number(payload.amount) : unpaidAmount;

  if (requestedAmount <= 0) {
    throw new AppError("No unpaid commission is available for payout", 409, "NO_UNPAID_COMMISSION");
  }

  if (requestedAmount - unpaidAmount > 0.009) {
    throw new AppError("Requested payout exceeds unpaid commission balance", 409, "PAYOUT_AMOUNT_TOO_HIGH");
  }

  return AgentPayoutRequest.create({
    agentId,
    amount: money(requestedAmount),
    currency: payload.currency || "USD",
    notes: payload.notes || ""
  });
};

const getAgentNotifications = async (agentId) => {
  const bookings = await Booking.find({ agentId }).select("_id bookingReference").lean();
  const bookingIds = bookings.map((booking) => booking._id.toString());
  const refs = bookings.map((booking) => booking.bookingReference);

  return AuditLog.find({
    $or: [
      { actorId: String(agentId) },
      { entityType: "Booking", entityId: { $in: bookingIds } },
      { "after.bookingReference": { $in: refs } },
      { "metadata.bookingReference": { $in: refs } }
    ]
  })
    .sort({ createdAt: -1 })
    .limit(80)
    .lean();
};

const getAgentActivity = async (agentId) => {
  return getAgentNotifications(agentId);
};

const getAgentPerformanceReport = async (agentId) => {
  const agentObjectId = new mongoose.Types.ObjectId(agentId);
  const [byMonth, topProducts, statusBreakdown] = await Promise.all([
    Booking.aggregate([
      { $match: { agentId: agentObjectId } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          bookings: { $sum: 1 },
          sales: { $sum: "$amount" }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 12 }
    ]),
    Booking.aggregate([
      { $match: { agentId: agentObjectId } },
      {
        $group: {
          _id: "$productTitle",
          bookings: { $sum: 1 },
          sales: { $sum: "$amount" }
        }
      },
      { $sort: { bookings: -1 } },
      { $limit: 10 }
    ]),
    Booking.aggregate([
      { $match: { agentId: agentObjectId } },
      { $group: { _id: "$bookingStatus", count: { $sum: 1 } } }
    ])
  ]);

  return {
    byMonth,
    topProducts,
    statusBreakdown
  };
};

const acceptTerms = async (agentId, version = "2026-07") => {
  const agent = await Agent.findByIdAndUpdate(
    agentId,
    {
      $set: {
        termsAcceptedAt: new Date(),
        termsVersion: version
      }
    },
    { new: true }
  ).lean();

  if (!agent) {
    throw new AppError("Agent not found", 404, "AGENT_NOT_FOUND");
  }

  return buildAgentPublicProfile(agent);
};

const getAgentProfile = async (agentId) => {
  const agent = await ensureReferralCode(await Agent.findById(agentId));
  if (!agent) {
    throw new AppError("Agent not found", 404, "AGENT_NOT_FOUND");
  }

  return buildAgentPublicProfile(agent.toObject());
};

const updateAgentProfile = async (agentId, payload = {}) => {
  const agent = await Agent.findById(agentId).select("+password");
  if (!agent) {
    throw new AppError("Agent not found", 404, "AGENT_NOT_FOUND");
  }

  const allowedFields = [
    "companyName",
    "contactFirstName",
    "contactLastName",
    "email",
    "phone",
    "country",
    "address",
    "agentType",
    "profilePhotoUrl"
  ];

  allowedFields.forEach((field) => {
    if (payload[field] !== undefined) {
      agent[field] = field === "email" ? String(payload[field]).toLowerCase() : payload[field];
    }
  });

  if (payload.newPassword) {
    if (!payload.currentPassword) {
      throw new AppError("Current password is required", 400, "CURRENT_PASSWORD_REQUIRED");
    }
    const matches = await agent.comparePassword(payload.currentPassword);
    if (!matches) {
      throw new AppError("Current password is incorrect", 401, "INVALID_CURRENT_PASSWORD");
    }
    agent.password = payload.newPassword;
  }

  await agent.save();
  return buildAgentPublicProfile(agent.toObject());
};

const getPayoutMethod = async (agentId) => {
  const agent = await Agent.findById(agentId).select("payoutMethod").lean();
  const payout = agent?.payoutMethod || {};

  return {
    ...payout,
    bankAccountNumberMasked: maskAccount(payout.bankAccountNumber),
    mobileMoneyNumberMasked: maskAccount(payout.mobileMoneyNumber)
  };
};

const updatePayoutMethod = async (agentId, payload = {}) => {
  const agent = await Agent.findById(agentId);
  if (!agent) {
    throw new AppError("Agent not found", 404, "AGENT_NOT_FOUND");
  }

  agent.payoutMethod = {
    payoutMethod: payload.payoutMethod,
    accountHolderName: payload.accountHolderName,
    bankName: payload.bankName || "",
    bankAccountNumber: payload.bankAccountNumber || "",
    bankBranch: payload.bankBranch || "",
    mobileMoneyProvider: payload.mobileMoneyProvider || "",
    mobileMoneyNumber: payload.mobileMoneyNumber || "",
    paypalEmail: payload.paypalEmail || "",
    wiseEmail: payload.wiseEmail || "",
    payoutNotes: payload.payoutNotes || "",
    updatedAt: new Date()
  };

  await agent.save();
  return getPayoutMethod(agentId);
};

const getSettings = async (agentId) => {
  const agent = await Agent.findById(agentId).select("settings").lean();
  return agent?.settings || {};
};

const updateSettings = async (agentId, payload = {}) => {
  const agent = await Agent.findByIdAndUpdate(
    agentId,
    { $set: { settings: payload } },
    { new: true }
  ).lean();
  return agent?.settings || {};
};

const updateAgentStatus = async (agentId, payload = {}) => {
  return Agent.findByIdAndUpdate(
    agentId,
    {
      $set: {
        ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
        ...(payload.approvalStatus ? { approvalStatus: payload.approvalStatus } : {})
      }
    },
    { new: true }
  ).select("-password");
};

const updateAgentCommission = async (agentId, payload = {}) => {
  return Agent.findByIdAndUpdate(
    agentId,
    { $set: { commissionPercent: payload.commissionPercent } },
    { new: true }
  ).select("-password");
};

module.exports = {
  createAgent,
  listAgents,
  getAgentDashboard,
  getAgentMonthlyStatement,
  listAgentBookings,
  getAgentBookingDetails,
  getAgentVoucher,
  resendAgentVoucher,
  getAgentCommissions,
  listPayoutRequests,
  requestPayout,
  getAgentNotifications,
  getAgentActivity,
  getAgentPerformanceReport,
  acceptTerms,
  getAgentProfile,
  updateAgentProfile,
  getPayoutMethod,
  updatePayoutMethod,
  getSettings,
  updateSettings,
  updateAgentStatus,
  updateAgentCommission
};
