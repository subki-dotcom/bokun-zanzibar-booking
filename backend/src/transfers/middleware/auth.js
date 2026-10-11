const rateLimit = require("express-rate-limit");
const AppError = require("../../utils/AppError");
const { verifyTransferToken } = require("../security/tokens");
const { isTransferRole, permissionsForTransferRole } = require("../security/permissions");

const bearer = (header = "") => (header.startsWith("Bearer ") ? header.slice(7).trim() : "");

// Authenticates a Transfer Admin user. Only tokens signed with TRANSFER_JWT_SECRET for the Transfer Admin
// audience are accepted, and the user must still exist, be active and hold the same token version.
const createTransferAuthenticate = ({ getStore, tokenConfig }) => async (req, _res, next) => {
  try {
    const token = bearer(req.headers.authorization || "");
    if (!token) throw new AppError("Unauthorized", 401, "TRANSFER_UNAUTHORIZED");
    let payload;
    try {
      payload = verifyTransferToken(token, tokenConfig());
    } catch (_error) {
      throw new AppError("Invalid or expired session", 401, "TRANSFER_INVALID_TOKEN");
    }
    const { models } = await getStore();
    const user = await models.AdminUser.findById(payload.sub).lean();
    if (!user || user.isActive === false || !isTransferRole(user.role) || (payload.tv || 0) !== (user.tokenVersion || 0)) {
      throw new AppError("Please sign in again", 401, "TRANSFER_INVALID_TOKEN");
    }
    req.transferAuth = {
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
      permissions: permissionsForTransferRole(user.role)
    };
    return next();
  } catch (error) {
    return next(error);
  }
};

const requireTransferPermission = (...permissions) => (req, _res, next) => {
  if (!req.transferAuth) return next(new AppError("Unauthorized", 401, "TRANSFER_UNAUTHORIZED"));
  if (!permissions.some((permission) => req.transferAuth.permissions.includes(permission))) {
    return next(new AppError("Forbidden", 403, "TRANSFER_FORBIDDEN", { requiredPermissions: permissions }));
  }
  return next();
};

const transferLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many sign-in attempts. Please wait and try again.",
    error: { code: "TRANSFER_LOGIN_RATE_LIMITED", details: null },
    data: {},
    meta: {}
  }
});

module.exports = { createTransferAuthenticate, requireTransferPermission, transferLoginLimiter };
