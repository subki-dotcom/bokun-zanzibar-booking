const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const hpp = require("hpp");
const { env } = require("./config/env");
const { parseTrustProxy } = require("./config/trustProxy");
const { buildAllowedOrigins, isOriginAllowed, normalizeOriginValue } = require("./config/corsOrigins");
const logger = require("./config/logger");
const systemHealthService = require("./services/systemHealth");
const apiRoutes = require("./routes");
const requestId = require("./middleware/requestId");
const { globalRateLimiter } = require("./middleware/rateLimiter");
const { sanitizePayload, sanitizeMongo } = require("./middleware/sanitize");
const notFound = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");

const app = express();
// Deployment-specific: see TRUST_PROXY in .env.example. Rate limits key on the resulting req.ip.
app.set("trust proxy", parseTrustProxy(env.TRUST_PROXY));

morgan.token("request-id", (req) => req.requestId || "-");
app.use(requestId);
app.use(helmet());
const allowedOrigins = buildAllowedOrigins({
  frontendUrl: env.FRONTEND_URL,
  backofficeUrl: env.BACKOFFICE_URL,
  transferAdminUrl: env.TRANSFER_ADMIN_URL,
  nodeEnv: env.NODE_ENV
});
const pesapalIpnPath = "/api/payments/pesapal/ipn";
const transferPesapalIpnPath = "/api/transfers/payments/ipn";

const corsMiddleware = cors({
  origin(origin, callback) {
      const normalizedOrigin = normalizeOriginValue(origin);
      // Allow server-to-server and health checks without origin header
      if (!origin) {
        return callback(null, true);
      }

      if (isOriginAllowed({ origin, allowedOrigins, nodeEnv: env.NODE_ENV })) {
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
  if (req.path === pesapalIpnPath || req.path === transferPesapalIpnPath) {
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
