const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const agentsService = require("../services/agents");
const toursService = require("../services/tours");
const bookingService = require("../services/bookings");

const createAgent = asyncHandler(async (req, res) => {
  const data = await agentsService.createAgent(req.validated.body);

  return successResponse(res, {
    message: "Agent created",
    data,
    statusCode: 201
  });
});

const listAgents = asyncHandler(async (_req, res) => {
  const data = await agentsService.listAgents();

  return successResponse(res, {
    message: "Agents fetched",
    data
  });
});

const products = asyncHandler(async (req, res) => {
  const page = Number.parseInt(req.query.page || "1", 10);
  const limit = Number.parseInt(req.query.limit || "12", 10);
  const data = await toursService.listTours({ page, limit, requestId: req.requestId });

  return successResponse(res, {
    message: "Agent products fetched",
    data: data.items,
    meta: data.pagination
  });
});

const productOptions = asyncHandler(async (req, res) => {
  const data = await toursService.getTourOptions(req.params.id, req.requestId);

  return successResponse(res, {
    message: "Agent product options fetched",
    data
  });
});

const myDashboard = asyncHandler(async (req, res) => {
  const data = await agentsService.getAgentDashboard(req.auth.id);

  return successResponse(res, {
    message: "Agent dashboard fetched",
    data
  });
});

const validateBooking = asyncHandler(async (req, res) => {
  const data = await bookingService.quoteBooking({
    payload: req.body,
    auth: req.auth || null,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: "Agent booking validated",
    data
  });
});

const myMonthlyStatement = asyncHandler(async (req, res) => {
  const data = await agentsService.getAgentMonthlyStatement(req.auth.id, req.params.month);

  return successResponse(res, {
    message: "Agent monthly statement fetched",
    data
  });
});

const myBookings = asyncHandler(async (req, res) => {
  const data = await agentsService.listAgentBookings(req.auth.id, req.query || {});

  return successResponse(res, {
    message: "Agent bookings fetched",
    data
  });
});

const myBookingDetails = asyncHandler(async (req, res) => {
  const data = await agentsService.getAgentBookingDetails(req.auth.id, req.params.id);

  return successResponse(res, {
    message: "Agent booking details fetched",
    data
  });
});

const myBookingVoucher = asyncHandler(async (req, res) => {
  const data = await agentsService.getAgentVoucher(req.auth.id, req.params.id);

  return successResponse(res, {
    message: "Agent booking voucher fetched",
    data
  });
});

const resendVoucher = asyncHandler(async (req, res) => {
  const data = await agentsService.resendAgentVoucher(req.auth.id, req.params.id, req.requestId);

  return successResponse(res, {
    message: "Voucher resend/share details prepared",
    data
  });
});

const myCommissions = asyncHandler(async (req, res) => {
  const data = await agentsService.getAgentCommissions(req.auth.id);

  return successResponse(res, {
    message: "Agent commissions fetched",
    data
  });
});

const myPayoutRequests = asyncHandler(async (req, res) => {
  const data = await agentsService.listPayoutRequests(req.auth.id);

  return successResponse(res, {
    message: "Agent payout requests fetched",
    data
  });
});

const requestPayout = asyncHandler(async (req, res) => {
  const data = await agentsService.requestPayout(req.auth.id, req.body || {});

  return successResponse(res, {
    message: "Payout request submitted",
    data,
    statusCode: 201
  });
});

const myNotifications = asyncHandler(async (req, res) => {
  const data = await agentsService.getAgentNotifications(req.auth.id);

  return successResponse(res, {
    message: "Agent notifications fetched",
    data
  });
});

const myActivity = asyncHandler(async (req, res) => {
  const data = await agentsService.getAgentActivity(req.auth.id);

  return successResponse(res, {
    message: "Agent activity fetched",
    data
  });
});

const myReports = asyncHandler(async (req, res) => {
  const data = await agentsService.getAgentPerformanceReport(req.auth.id);

  return successResponse(res, {
    message: "Agent reports fetched",
    data
  });
});

const acceptTerms = asyncHandler(async (req, res) => {
  const data = await agentsService.acceptTerms(req.auth.id, req.body?.version || "2026-07");

  return successResponse(res, {
    message: "Agent terms accepted",
    data
  });
});

const myProfile = asyncHandler(async (req, res) => {
  const data = await agentsService.getAgentProfile(req.auth.id);

  return successResponse(res, {
    message: "Agent profile fetched",
    data
  });
});

const updateMyProfile = asyncHandler(async (req, res) => {
  const data = await agentsService.updateAgentProfile(req.auth.id, req.validated.body);

  return successResponse(res, {
    message: "Agent profile updated",
    data
  });
});

const myPayoutMethod = asyncHandler(async (req, res) => {
  const data = await agentsService.getPayoutMethod(req.auth.id);

  return successResponse(res, {
    message: "Agent payout method fetched",
    data
  });
});

const updateMyPayoutMethod = asyncHandler(async (req, res) => {
  const data = await agentsService.updatePayoutMethod(req.auth.id, req.validated.body);

  return successResponse(res, {
    message: "Agent payout method updated",
    data
  });
});

const mySettings = asyncHandler(async (req, res) => {
  const data = await agentsService.getSettings(req.auth.id);

  return successResponse(res, {
    message: "Agent settings fetched",
    data
  });
});

const updateMySettings = asyncHandler(async (req, res) => {
  const data = await agentsService.updateSettings(req.auth.id, req.validated.body);

  return successResponse(res, {
    message: "Agent settings updated",
    data
  });
});

const updateStatus = asyncHandler(async (req, res) => {
  const data = await agentsService.updateAgentStatus(req.params.id, req.validated.body);

  return successResponse(res, {
    message: "Agent status updated",
    data
  });
});

const updateCommission = asyncHandler(async (req, res) => {
  const data = await agentsService.updateAgentCommission(req.params.id, req.validated.body);

  return successResponse(res, {
    message: "Agent commission updated",
    data
  });
});

module.exports = {
  createAgent,
  listAgents,
  products,
  productOptions,
  myDashboard,
  validateBooking,
  myMonthlyStatement,
  myBookings,
  myBookingDetails,
  myBookingVoucher,
  resendVoucher,
  myCommissions,
  myPayoutRequests,
  requestPayout,
  myNotifications,
  myActivity,
  myReports,
  acceptTerms,
  myProfile,
  updateMyProfile,
  myPayoutMethod,
  updateMyPayoutMethod,
  mySettings,
  updateMySettings,
  updateStatus,
  updateCommission
};
