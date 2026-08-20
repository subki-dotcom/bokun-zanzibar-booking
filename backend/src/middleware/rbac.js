const AppError = require("../utils/AppError");
const { hasAnyPermission } = require("../security/permissions");

const authorize = (...roles) => {
  return (req, _res, next) => {
    if (!req.auth) {
      return next(new AppError("Unauthorized", 401, "UNAUTHORIZED"));
    }

    if (!roles.includes(req.auth.role)) {
      return next(new AppError("Forbidden", 403, "FORBIDDEN"));
    }

    return next();
  };
};

const authorizePermission = (...permissions) => {
  return (req, _res, next) => {
    if (!req.auth) {
      return next(new AppError("Unauthorized", 401, "UNAUTHORIZED"));
    }

    if (!hasAnyPermission(req.auth, permissions)) {
      return next(
        new AppError("Forbidden", 403, "FORBIDDEN_PERMISSION", {
          requiredPermissions: permissions,
          role: req.auth.role
        })
      );
    }

    return next();
  };
};

module.exports = {
  authorize,
  authorizePermission
};
