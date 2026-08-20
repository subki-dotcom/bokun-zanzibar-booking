const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const hpp = require("hpp");
const { env } = require("./config/env");
const logger = require("./config/logger");
const systemHealthService = require("./services/systemHealth");
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
const pesapalIpnPath = "/api/payments/pesapal/ipn";

const corsMiddleware = cors({
  origin(origin, callback) {
      const normalizedOrigin = normalizeOriginValue(origin);
      // Allow server-to-server and health checks without origin header
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(normalizedOrigin)) {
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
});

app.use((req, res, next) => {
  // Pesapal's IPN is a server-to-server notification, not a browser request.
  // Its transaction is still authenticated by a server-side Pesapal status
  // verification, so it must not be blocked by the public website allow-list.
  if (req.path === pesapalIpnPath) {
    return next();
  }

  return corsMiddleware(req, res, next);
});
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

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "Zanzibar Bokun backend is running",
    data: systemHealthService.getLiveHealth(),
    meta: {}
  });
});

app.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "API healthy",
    data: systemHealthService.getLiveHealth(),
    meta: {}
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "API healthy",
    data: systemHealthService.getLiveHealth(),
    meta: {}
  });
});

app.get("/api/health/live", (_req, res) => {
  res.json({
    success: true,
    message: "API live",
    data: systemHealthService.getLiveHealth(),
    meta: {}
  });
});

app.get("/api/health/ready", (_req, res) => {
  const data = systemHealthService.getReadinessHealth();
  return res.status(data.ready ? 200 : 503).json({
    success: data.ready,
    message: data.ready ? "API ready" : "API is not ready",
    data,
    meta: {}
  });
});

app.use("/api", apiRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
