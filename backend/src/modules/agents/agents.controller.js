const asyncHandler = require("../../utils/asyncHandler");
const { successResponse } = require("../../utils/apiResponse");
const agentsService = require("./agents.service");

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

const myDashboard = asyncHandler(async (req, res) => {
  const data = await agentsService.getAgentDashboard(req.auth.id);

  return successResponse(res, {
    message: "Agent dashboard fetched",
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

module.exports = {
  createAgent,
  listAgents,
  myDashboard,
  myMonthlyStatement
};