const jwt = require("jsonwebtoken");
const { env } = require("../config/env");
const User = require("../models/User");
const Agent = require("../models/Agent");
const AppError = require("../utils/AppError");

const extractToken = (header) => {
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }

  return header.split(" ")[1];
};

const authenticate = async (req, _res, next) => {
  const token = extractToken(req.headers.authorization);

  if (!token) {
    return next(new AppError("Unauthorized", 401, "UNAUTHORIZED"));
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    const Model = payload.userType === "agent" ? Agent : User;
    const user = await Model.findById(payload.sub).lean();

    if (!user || !user.isActive) {
      return next(new AppError("Account not found or inactive", 401, "ACCOUNT_INACTIVE"));
    }

    req.auth = {
      id: user._id.toString(),
      role: user.role,
      userType: payload.userType || "user",
      agentId: user.agentProfileId || null,
      email: user.email
    };

    return next();
  } catch (_error) {
    return next(new AppError("Invalid or expired token", 401, "INVALID_TOKEN"));
  }
};

module.exports = {
  authenticate
};