const logger = {
  info(message, meta = {}) {
    console.log(JSON.stringify({ level: "info", message, ...meta, ts: new Date().toISOString() }));
  },
  warn(message, meta = {}) {
    console.warn(JSON.stringify({ level: "warn", message, ...meta, ts: new Date().toISOString() }));
  },
  error(message, meta = {}) {
    console.error(JSON.stringify({ level: "error", message, ...meta, ts: new Date().toISOString() }));
  },
  debug(message, meta = {}) {
    if (process.env.NODE_ENV !== "production") {
      console.debug(JSON.stringify({ level: "debug", message, ...meta, ts: new Date().toISOString() }));
    }
  }
};

module.exports = logger;