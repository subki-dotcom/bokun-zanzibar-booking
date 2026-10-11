const AppError = require("../../utils/AppError");
const { withTransaction } = require("../db/connection");
const { recordTransferAudit } = require("./audit");
const { hashPassword } = require("../security/password");
const { TRANSFER_ROLES } = require("../security/permissions");
const { userToApi } = require("./auth");

const createTransferUserService = ({ getStore, now = () => new Date() }) => {
  const list = async () => {
    const { models } = await getStore();
    const users = await models.AdminUser.find({}).sort({ name: 1 }).lean();
    return users.map(userToApi);
  };

  const create = async ({ actor, context, input }) => {
    const store = await getStore();
    return withTransaction(store, async (session) => {
      const [user] = await store.models.AdminUser.create(
        [{ name: input.name, email: input.email, role: input.role, passwordHash: await hashPassword(input.password), createdBy: actor.id, passwordChangedAt: now() }],
        session ? { session } : {}
      );
      await recordTransferAudit(store.models, { actor, action: "user.created", entityType: "TransferAdminUser", entityId: user._id, after: user, context }, session);
      return userToApi(user.toObject());
    });
  };

  // Keeps at least one active transfer_admin, and stops admins from locking themselves out.
  const assertAdminRemains = async (models, user, next, session) => {
    const stillAdmin = next.role === TRANSFER_ROLES.ADMIN && next.isActive !== false;
    if (user.role !== TRANSFER_ROLES.ADMIN || user.isActive === false || stillAdmin) return;
    const others = await models.AdminUser.countDocuments({ _id: { $ne: user._id }, role: TRANSFER_ROLES.ADMIN, isActive: true }).session(session);
    if (others === 0) throw new AppError("At least one active transfer_admin is required", 409, "TRANSFER_LAST_ADMIN");
  };

  const update = async ({ actor, context, userId, input }) => {
    const store = await getStore();
    return withTransaction(store, async (session) => {
      const user = await store.models.AdminUser.findById(userId).session(session);
      if (!user) throw new AppError("User not found", 404, "TRANSFER_NOT_FOUND", { entity: "User" });
      if (String(user._id) === actor.id && ((input.role && input.role !== user.role) || input.isActive === false)) {
        throw new AppError("You cannot change your own role or deactivate yourself", 409, "TRANSFER_SELF_CHANGE");
      }
      const next = { role: input.role ?? user.role, isActive: input.isActive ?? user.isActive };
      await assertAdminRemains(store.models, user, next, session);
      const before = user.toObject();
      const accessChanged = next.role !== user.role || next.isActive !== user.isActive;
      if (input.name !== undefined) user.name = input.name;
      user.role = next.role;
      user.isActive = next.isActive;
      if (input.unlock) {
        user.lockedUntil = null;
        user.failedLoginCount = 0;
      }
      // Changing someone's access ends their existing sessions.
      if (accessChanged) user.tokenVersion = (user.tokenVersion || 0) + 1;
      await user.save({ session });
      await recordTransferAudit(store.models, { actor, action: "user.updated", entityType: "TransferAdminUser", entityId: user._id, before, after: user, reason: input.reason || "", context }, session);
      return userToApi(user.toObject());
    });
  };

  const resetPassword = async ({ actor, context, userId, password, reason = "" }) => {
    const store = await getStore();
    return withTransaction(store, async (session) => {
      const user = await store.models.AdminUser.findById(userId).session(session);
      if (!user) throw new AppError("User not found", 404, "TRANSFER_NOT_FOUND", { entity: "User" });
      user.passwordHash = await hashPassword(password);
      user.passwordChangedAt = now();
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      user.lockedUntil = null;
      user.failedLoginCount = 0;
      await user.save({ session });
      await recordTransferAudit(store.models, { actor, action: "user.password_reset", entityType: "TransferAdminUser", entityId: user._id, reason, context }, session);
      return userToApi(user.toObject());
    });
  };

  return { list, create, update, resetPassword };
};

const createTransferAuditQueryService = ({ getStore }) => {
  const list = async ({ query = {} }) => {
    const { models } = await getStore();
    const filter = {};
    ["action", "entityType", "entityId", "actorId"].forEach((field) => {
      if (query[field]) filter[field] = String(query[field]);
    });
    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) filter.createdAt.$gte = new Date(query.from);
      if (query.to) filter.createdAt.$lte = new Date(query.to);
    }
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const page = Math.max(1, Number(query.page) || 1);
    const [items, total] = await Promise.all([
      models.AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      models.AuditLog.countDocuments(filter)
    ]);
    return {
      items: items.map((item) => ({ ...item, id: String(item._id), _id: undefined })),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    };
  };
  return { list };
};

module.exports = { createTransferUserService, createTransferAuditQueryService };
