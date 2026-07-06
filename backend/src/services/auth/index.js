const jwt = require("jsonwebtoken");
const User = require("../../models/User");
const Agent = require("../../models/Agent");
const { env } = require("../../config/env");
const AppError = require("../../utils/AppError");

const signToken = ({ id, role, userType }) => {
  return jwt.sign(
    {
      sub: id,
      role,
      userType
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
};

const canSeedAdmin = async () => {
  const count = await User.countDocuments({});
  return count === 0;
};

const registerAdmin = async (payload, auth) => {
  const { firstName, lastName, email, password, role } = payload;

  const firstAdminAllowed = await canSeedAdmin();
  if (!firstAdminAllowed && (!auth || auth.role !== "super_admin")) {
    throw new AppError(
      "Only super_admin can create additional admins after initial seed",
      403,
      "FORBIDDEN_ADMIN_CREATION"
    );
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw new AppError("Email already in use", 409, "EMAIL_EXISTS");
  }

  const user = await User.create({
    firstName,
    lastName,
    email: email.toLowerCase(),
    password,
    role: firstAdminAllowed ? "super_admin" : role || "admin"
  });

  return {
    id: user._id,
    fullName: user.fullName,
    email: user.email,
    role: user.role
  };
};

const registerAgent = async (payload) => {
  const existing = await Agent.findOne({ email: payload.email.toLowerCase() });
  if (existing) {
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
    approvalStatus: "pending",
    isActive: true,
    notes: payload.notes || "Agent self-registration"
  });

  return {
    id: agent._id,
    companyName: agent.companyName,
    fullName: agent.fullName,
    email: agent.email,
    approvalStatus: agent.approvalStatus,
    accountStatus: agent.isActive ? "active" : "suspended"
  };
};

const login = async (payload) => {
  const { email, password, portal = "admin" } = payload;
  const normalizedEmail = email.toLowerCase();

  const isAgentPortal = portal === "agent";
  const Model = isAgentPortal ? Agent : User;

  const account = await Model.findOne({ email: normalizedEmail }).select("+password");

  if (!account) {
    throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");
  }

  const isValidPassword = await account.comparePassword(password);
  if (!isValidPassword) {
    throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");
  }

  if (!account.isActive) {
    throw new AppError("Account is disabled", 403, "ACCOUNT_DISABLED");
  }

  if (!isAgentPortal) {
    account.lastLoginAt = new Date();
    await account.save();
  }

  const token = signToken({
    id: account._id.toString(),
    role: account.role,
    userType: isAgentPortal ? "agent" : "user"
  });

  return {
    token,
    user: {
      id: account._id,
      fullName: account.fullName,
      email: account.email,
      role: account.role,
      userType: isAgentPortal ? "agent" : "user",
      companyName: account.companyName || null,
      approvalStatus: account.approvalStatus || "approved",
      accountStatus: account.isActive ? "active" : "suspended",
      termsAcceptedAt: account.termsAcceptedAt || null,
      termsVersion: account.termsVersion || ""
    }
  };
};

const getProfile = async (auth) => {
  const Model = auth.userType === "agent" ? Agent : User;
  const user = await Model.findById(auth.id).lean();

  if (!user) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  return {
    id: user._id,
    fullName: user.fullName,
    firstName: user.firstName || user.contactFirstName,
    lastName: user.lastName || user.contactLastName,
    email: user.email,
    role: user.role,
    userType: auth.userType,
    companyName: user.companyName || null,
    commissionPercent: user.commissionPercent || null,
    approvalStatus: user.approvalStatus || "approved",
    accountStatus: user.isActive ? "active" : "suspended",
    termsAcceptedAt: user.termsAcceptedAt || null,
    termsVersion: user.termsVersion || ""
  };
};

module.exports = {
  registerAdmin,
  registerAgent,
  login,
  getProfile,
  signToken,
  canSeedAdmin
};
