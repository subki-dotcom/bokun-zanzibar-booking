const AppError = require("../utils/AppError");

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

module.exports = {
  authorize
};