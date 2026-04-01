const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const hpp = require("hpp");

const { env } = require("./config/env");
const logger = require("./config/logger");
const apiRoutes = require("./routes");
const requestId = require("./middleware/requestId");
const { globalRateLimiter } = require("./middleware/rateLimiter");
const { sanitizePayload, sanitizeMongo } = require("./middleware/sanitize");
const notFound = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");

const app = express();

morgan.token("request-id", (req) => req.requestId || "-");
app.use(requestId);
app.use(helmet());
const allowedOrigins = [
  env.FRONTEND_URL,
  "http://127.0.0.1:5173",
  "http://localhost:5173"
].filter(Boolean);
const devOriginPattern = /^https?:\/\/(127\.0\.0\.1|localhost):\d+$/i;

app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server and health checks without origin header
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      if (env.NODE_ENV !== "production" && devOriginPattern.test(origin)) {
        return callback(null, true);
      }

      return callback(new Error("CORS_ORIGIN_NOT_ALLOWED"));
    },
    credentials: true
  })
);
app.use(globalRateLimiter);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeMongo);
app.use(sanitizePayload);
app.use(hpp());
app.use(
  morgan(":method :url :status :response-time ms req_id=:request-id", {
    stream: {
      write: (message) => logger.info(message.trim())
    }
  })
);

app.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "API healthy",
    data: {
      uptimeSeconds: process.uptime()
    },
    meta: {}
  });
});

app.use("/api", apiRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
