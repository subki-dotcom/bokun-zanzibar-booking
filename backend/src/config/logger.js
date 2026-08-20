const SENSITIVE_KEY_PATTERN = /(secret|password|passwd|pwd|token|authorization|api.?key|private.?key|consumer.?secret|client.?secret|bearer|credential)/i;

const maskMongoUri = (value = "") =>
  String(value || "")
    .replace(/(mongodb(?:\+srv)?:\/\/)([^:@/?#]+):([^@/?#]+)@/gi, "$1[redacted]:[redacted]@")
    .replace(/([?&](?:authSource|replicaSet|tlsCertificateKeyFilePassword|password)=)[^&]+/gi, "$1[redacted]");

const redactString = (value = "") =>
  maskMongoUri(String(value || ""))
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|secret|password)=([^&\s]+)/gi, "$1=[redacted]");

const sanitizeLogValue = (key = "", value, depth = 0) => {
  if (SENSITIVE_KEY_PATTERN.test(String(key || ""))) return "[redacted]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message)
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (depth >= 4) return "[truncated]";
    return value.slice(0, 50).map((item) => sanitizeLogValue(key, item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= 4) return "[truncated]";
    return Object.entries(value).reduce((safe, [childKey, childValue]) => {
      safe[childKey] = sanitizeLogValue(childKey, childValue, depth + 1);
      return safe;
    }, {});
  }
  return value;
};

const sanitizeLogMeta = (meta = {}) =>
  sanitizeLogValue("meta", meta) || {};

const write = (level, output, message, meta = {}) => {
  output(JSON.stringify({
    level,
    message: redactString(message),
    ...sanitizeLogMeta(meta),
    ts: new Date().toISOString()
  }));
};

const logger = {
  info(message, meta = {}) {
    write("info", console.log, message, meta);
  },
  warn(message, meta = {}) {
    write("warn", console.warn, message, meta);
  },
  error(message, meta = {}) {
    write("error", console.error, message, meta);
  },
  debug(message, meta = {}) {
    if (process.env.NODE_ENV !== "production") {
      write("debug", console.debug, message, meta);
    }
  },
  __testables: {
    maskMongoUri,
    redactString,
    sanitizeLogMeta
  }
};

module.exports = logger;
