const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const authService = require("../services/auth");

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.validated.body);

  return successResponse(res, {
    message: "Login successful",
    data: result
  });
});

const registerAdmin = asyncHandler(async (req, res) => {
  const created = await authService.registerAdmin(req.validated.body, req.auth || null);

  return successResponse(res, {
    message: "Admin account created",
    data: created,
    statusCode: 201
  });
});

const registerAgent = asyncHandler(async (req, res) => {
  const created = await authService.registerAgent(req.validated.body);

  return successResponse(res, {
    message: "Agent application submitted",
    data: created,
    statusCode: 201
  });
});

const me = asyncHandler(async (req, res) => {
  const profile = await authService.getProfile(req.auth);

  return successResponse(res, {
    message: "Current profile",
    data: profile
  });
});

module.exports = {
  login,
  registerAdmin,
  registerAgent,
  me
};
