const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const adminSettingsService = require("../services/adminSettings");
const User = require("../models/User");

const overview = asyncHandler(async (_req, res) =>
  successResponse(res, {
    message: "Settings fetched",
    data: adminSettingsService.getOverview()
  })
);

const testEmail = asyncHandler(async (req, res) => {
  const user = await User.findById(req.auth?.id, { email: 1 }).lean();
  const data = await adminSettingsService.sendTestEmail({ to: user?.email || "" });
  return successResponse(res, {
    message: "Test email sent",
    data
  });
});

module.exports = { overview, testEmail };
