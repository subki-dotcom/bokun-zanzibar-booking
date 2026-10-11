const express = require("express");
const rateLimit = require("express-rate-limit");
const { env, isEmailConfigured } = require("../config/env");
const User = require("../models/User");
const logger = require("../config/logger");
const { sendPasswordResetEmail } = require("../services/email");
const { createPasswordRecovery } = require("../services/auth/passwordRecovery");
const { forgotPasswordSchema, resetPasswordSchema } = require("../validators/auth.validation");
const validateRequest = require("../middleware/validateRequest");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");

const router = express.Router();
const limiter = rateLimit({
  windowMs: 15 * 60000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: "Too many recovery attempts. Please wait 15 minutes before trying again." }
});
const recovery = createPasswordRecovery({
  User, sendEmail: sendPasswordResetEmail, configured: isEmailConfigured,
  siteUrl: env.PASSWORD_RESET_SITE_URL,
  logFailure: () => logger.error("Password reset email delivery failed")
});
const noStore = (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
};
router.post("/forgot-password", noStore, limiter, validateRequest(forgotPasswordSchema), asyncHandler(async (req, res) => {
  const result = await recovery.requestReset(req.validated.body);
  return successResponse(res, { message: result.message });
}));
router.post("/reset-password", noStore, limiter, validateRequest(resetPasswordSchema), asyncHandler(async (req, res) => {
  const result = await recovery.resetPassword(req.validated.body);
  return successResponse(res, { message: result.message });
}));
module.exports = router;
