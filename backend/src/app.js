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
app.set("trust proxy", 1);

morgan.token("request-id", (req) => req.requestId || "-");
app.use(requestId);
app.use(helmet());
const productionFrontendOrigin = "https://bokun-zanzibar-booking.vercel.app";
const normalizeOriginValue = (value = "") => String(value || "").trim().replace(/\/+$/, "");
const isTrustedVercelProjectOrigin = (origin = "") => {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname.endsWith(".vercel.app") && hostname.includes("bokun-zanzibar-booking");
  } catch (_error) {
    return false;
  }
};
const configuredFrontendOrigins = String(env.FRONTEND_URL || "")
  .split(",")
  .map((value) => normalizeOriginValue(value))
  .filter(Boolean);
const allowedOrigins = Array.from(
  new Set([
    ...configuredFrontendOrigins,
    normalizeOriginValue(productionFrontendOrigin)
  ])
);
const devOriginPattern = /^https?:\/\/(127\.0\.0\.1|localhost):\d+$/i;

app.use(
  cors({
    origin(origin, callback) {
      const normalizedOrigin = normalizeOriginValue(origin);
      // Allow server-to-server and health checks without origin header
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      // Allow Vercel preview deployments for this project.
      if (isTrustedVercelProjectOrigin(normalizedOrigin)) {
        return callback(null, true);
      }

      if (env.NODE_ENV !== "production" && devOriginPattern.test(origin)) {
        return callback(null, true);
      }

      const corsError = new Error("CORS_ORIGIN_NOT_ALLOWED");
      corsError.statusCode = 403;
      corsError.code = "CORS_ORIGIN_NOT_ALLOWED";
      corsError.isOperational = true;
      corsError.details = {
        origin: normalizedOrigin,
        allowedOrigins
      };
      return callback(corsError);
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

const buildHealthPayload = () => ({
  status: "ok",
  timestamp: new Date().toISOString(),
  environment: env.NODE_ENV,
  uptimeSeconds: Number(process.uptime().toFixed(2))
});

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "Zanzibar Bokun backend is running",
    data: buildHealthPayload(),
    meta: {}
  });
});

app.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "API healthy",
    data: buildHealthPayload(),
    meta: {}
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "API healthy",
    data: buildHealthPayload(),
    meta: {}
  });
});

app.use("/api", apiRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
