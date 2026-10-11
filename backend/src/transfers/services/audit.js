const SENSITIVE_KEYS = new Set(["passwordHash", "password", "token", "tokenVersion", "__v"]);

// Plain, secret-free copy of a record for the audit trail.
const auditSnapshot = (value) => {
  if (value === null || value === undefined) return value;
  const plain = typeof value.toObject === "function" ? value.toObject({ depopulate: true }) : value;
  return JSON.parse(
    JSON.stringify(plain, (key, item) => {
      if (SENSITIVE_KEYS.has(key)) return undefined;
      if (item && typeof item === "object" && typeof item.$numberDecimal === "string") return item.$numberDecimal;
      return item;
    })
  );
};

const requestContext = (req = {}) => ({
  requestId: req.requestId || "",
  ipAddress: req.ip || req.socket?.remoteAddress || "",
  userAgent: String(req.headers?.["user-agent"] || "").slice(0, 300)
});

const recordTransferAudit = async (
  models,
  { actor = null, action, entityType, entityId = "", before = null, after = null, reason = "", context = {} },
  session = null
) => {
  const [entry] = await models.AuditLog.create(
    [
      {
        actorId: actor?.id || "",
        actorEmail: actor?.email || "",
        actorRole: actor?.role || "",
        action,
        entityType,
        entityId: String(entityId || ""),
        reason,
        before: auditSnapshot(before),
        after: auditSnapshot(after),
        requestId: context.requestId || "",
        ipAddress: context.ipAddress || "",
        userAgent: context.userAgent || ""
      }
    ],
    session ? { session } : {}
  );
  return entry;
};

module.exports = { auditSnapshot, requestContext, recordTransferAudit };
