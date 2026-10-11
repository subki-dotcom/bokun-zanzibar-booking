const AppError = require("../../utils/AppError");
const { withTransaction } = require("../db/connection");
const { recordTransferAudit } = require("./audit");
const { hashPassword, verifyPassword } = require("../security/password");
const { signTransferToken } = require("../security/tokens");
const { isTransferRole, permissionsForTransferRole, TRANSFER_ROLES } = require("../security/permissions");

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

const invalidCredentials = () =>
  new AppError("Invalid email or password, or the account is temporarily locked.", 401, "TRANSFER_INVALID_CREDENTIALS");

const userToApi = (user) =>
  user && {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: permissionsForTransferRole(user.role),
    isActive: user.isActive !== false,
    lockedUntil: user.lockedUntil && user.lockedUntil > new Date() ? user.lockedUntil : null,
    lastLoginAt: user.lastLoginAt || null,
    passwordChangedAt: user.passwordChangedAt || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };

const createTransferAuthService = ({ getStore, tokenConfig, now = () => new Date() }) => {
  const login = async ({ email, password, context }) => {
    const store = await getStore();
    const { AdminUser } = store.models;
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const user = await AdminUser.findOne({ email: normalizedEmail }).select("+passwordHash");
    // Always run bcrypt so unknown emails and wrong passwords take the same time.
    const passwordOk = await verifyPassword(password, user?.passwordHash);
    const locked = Boolean(user?.lockedUntil && user.lockedUntil > now());

    if (!user || !passwordOk || locked || user.isActive === false || !isTransferRole(user.role)) {
      if (user && !locked && !passwordOk) {
        const failed = (user.failedLoginCount || 0) + 1;
        const update = failed >= MAX_FAILED_LOGINS
          ? { $set: { failedLoginCount: 0, lockedUntil: new Date(now().getTime() + LOCK_MINUTES * 60000) } }
          : { $inc: { failedLoginCount: 1 } };
        await AdminUser.updateOne({ _id: user._id }, update);
        if (failed >= MAX_FAILED_LOGINS) {
          await recordTransferAudit(store.models, { action: "auth.account_locked", entityType: "TransferAdminUser", entityId: user._id, after: { lockMinutes: LOCK_MINUTES }, context: { ...context } });
        }
      }
      await recordTransferAudit(store.models, {
        actor: user ? { id: String(user._id), email: user.email, role: user.role } : { email: normalizedEmail },
        action: "auth.login_failed",
        entityType: "TransferAdminUser",
        entityId: user?._id || "",
        reason: !user ? "unknown_email" : locked ? "locked" : user.isActive === false ? "inactive" : !passwordOk ? "wrong_password" : "invalid_role",
        context
      });
      throw invalidCredentials();
    }

    await AdminUser.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now() } });
    await recordTransferAudit(store.models, { actor: { id: String(user._id), email: user.email, role: user.role }, action: "auth.login_succeeded", entityType: "TransferAdminUser", entityId: user._id, context });
    return { token: signTransferToken(user, tokenConfig()), user: userToApi({ ...user.toObject(), lastLoginAt: now() }) };
  };

  const me = async ({ actor }) => {
    const { models } = await getStore();
    return userToApi(await models.AdminUser.findById(actor.id).lean());
  };

  const changePassword = async ({ actor, currentPassword, newPassword, context }) => {
    const store = await getStore();
    return withTransaction(store, async (session) => {
      const user = await store.models.AdminUser.findById(actor.id).select("+passwordHash").session(session);
      if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
        throw new AppError("Current password is incorrect", 422, "TRANSFER_CURRENT_PASSWORD_INCORRECT");
      }
      if (await verifyPassword(newPassword, user.passwordHash)) {
        throw new AppError("Choose a password you have not used for this account", 422, "TRANSFER_PASSWORD_REUSED");
      }
      user.passwordHash = await hashPassword(newPassword);
      user.passwordChangedAt = now();
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      await user.save({ session });
      await recordTransferAudit(store.models, { actor, action: "auth.password_changed", entityType: "TransferAdminUser", entityId: user._id, context }, session);
      // Other sessions are revoked; the caller gets a fresh token for this one.
      return { token: signTransferToken(user, tokenConfig()), user: userToApi(user.toObject()) };
    });
  };

  const logoutEverywhere = async ({ actor, context }) => {
    const store = await getStore();
    await withTransaction(store, async (session) => {
      await store.models.AdminUser.updateOne({ _id: actor.id }, { $inc: { tokenVersion: 1 } }, session ? { session } : {});
      await recordTransferAudit(store.models, { actor, action: "auth.sessions_revoked", entityType: "TransferAdminUser", entityId: actor.id, context }, session);
    });
    return { revoked: true };
  };

  // Creates the first transfer_admin. Refuses once any Transfer Admin user exists.
  const createFirstAdmin = async ({ name, email, password }) => {
    const store = await getStore();
    return withTransaction(store, async (session) => {
      const existing = await store.models.AdminUser.countDocuments({}).session(session);
      if (existing > 0) throw new AppError("Transfer Admin users already exist; add users from the Transfer Admin instead.", 409, "TRANSFER_ADMIN_ALREADY_SEEDED");
      const [user] = await store.models.AdminUser.create(
        [{ name, email, passwordHash: await hashPassword(password), role: TRANSFER_ROLES.ADMIN, createdBy: "seed-script", passwordChangedAt: now() }],
        session ? { session } : {}
      );
      await recordTransferAudit(store.models, { actor: { email: "seed-script" }, action: "user.created", entityType: "TransferAdminUser", entityId: user._id, after: user, reason: "first transfer_admin" }, session);
      return userToApi(user.toObject());
    });
  };

  return { login, me, changePassword, logoutEverywhere, createFirstAdmin };
};

module.exports = { MAX_FAILED_LOGINS, LOCK_MINUTES, userToApi, createTransferAuthService };
