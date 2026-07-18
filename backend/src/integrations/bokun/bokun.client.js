const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const crypto = require("crypto");
const { env, isBokunConfigured } = require("../../config/env");
const logger = require("../../config/logger");
const AppError = require("../../utils/AppError");
const {
  mockProducts,
  mockAvailability,
  mockPriceList,
  mockQuestions,
  mockBookingCreate
} = require("./mockBokunData");

const pad = (value) => String(value).padStart(2, "0");

const formatUtcDate = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
};

const getSignaturePath = (url) => {
  if (!url) {
    return "/";
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search || ""}`;
  }

  return url;
};

const createSignature = ({ dateHeader, method, path }) => {
  const signingString = `${dateHeader}${env.BOKUN_ACCESS_KEY}${method.toUpperCase()}${path}`;
  return crypto
    .createHmac("sha1", env.BOKUN_SECRET_KEY)
    .update(signingString)
    .digest("base64");
};

// Mock data must be explicitly enabled. Falling back silently when live
// credentials are missing could make a production checkout look available.
const shouldMock = Boolean(env.BOKUN_MOCK_MODE);

const ensureBokunConfigured = () => {
  if (isBokunConfigured) {
    return;
  }

  throw new AppError(
    "Bokun is not configured. Set BOKUN_ACCESS_KEY and BOKUN_SECRET_KEY, or explicitly enable BOKUN_MOCK_MODE for local development.",
    503,
    "BOKUN_NOT_CONFIGURED"
  );
};

const bokunAxios = axios.create({
  baseURL: env.BOKUN_BASE_URL,
  timeout: env.BOKUN_TIMEOUT_MS
});

axiosRetry(bokunAxios, {
  retries: env.BOKUN_RETRY_COUNT,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: axiosRetry.isNetworkOrIdempotentRequestError
});

bokunAxios.interceptors.request.use((config) => {
  const path = getSignaturePath(config.url || "/");
  const dateHeader = formatUtcDate();
  const signature = createSignature({
    dateHeader,
    method: config.method || "get",
    path
  });

  config.headers = {
    ...config.headers,
    "Content-Type": "application/json;charset=UTF-8",
    "X-Bokun-Date": dateHeader,
    "X-Bokun-AccessKey": env.BOKUN_ACCESS_KEY,
    "X-Bokun-Signature": signature
  };

  logger.debug("Bokun request", {
    method: config.method,
    url: config.url,
    signaturePath: path,
    requestId: config.headers["x-request-id"]
  });

  return config;
});

bokunAxios.interceptors.response.use(
  (response) => {
    logger.debug("Bokun response", {
      status: response.status,
      url: response.config.url
    });

    return response;
  },
  (error) => {
    const upstreamResponse = error.response?.data;
    const upstreamMessage =
      typeof upstreamResponse === "string"
        ? upstreamResponse
        : upstreamResponse?.message || error.message || "Unknown Bokun error";
    const isTimeout =
      error.code === "ECONNABORTED" ||
      /timeout|timed out/i.test(String(error.message || ""));
    const hasUpstreamResponse = Boolean(error.response);
    const statusCode = hasUpstreamResponse
      ? Number(error.response.status || 502)
      : isTimeout
        ? 504
        : 502;
    const details = {
      message: upstreamMessage,
      upstreamStatus: hasUpstreamResponse ? Number(error.response.status || 0) : null,
      url: error.config?.url || "",
      requestId: error.config?.headers?.["x-request-id"] || "",
      timeoutMs: Number(env.BOKUN_TIMEOUT_MS || 0) || null
    };
    const errorCode = hasUpstreamResponse
      ? "BOKUN_REQUEST_FAILED"
      : isTimeout
        ? "BOKUN_TIMEOUT"
        : "BOKUN_UPSTREAM_UNREACHABLE";
    const appMessage = isTimeout
      ? "Bokun supplier request timed out"
      : hasUpstreamResponse
        ? "Bokun API request failed"
        : "Unable to reach Bokun supplier";

    const expectedLookupMiss = Boolean(error.config?.bokunExpectedNotFound && statusCode === 404);
    const logDetails = {
      statusCode,
      details,
      url: error.config?.url
    };

    if (expectedLookupMiss) {
      logger.debug("Bokun booking lookup did not find a supplier booking", logDetails);
    } else {
      logger.error("Bokun API error", logDetails);
    }

    throw new AppError(appMessage, statusCode, errorCode, details);
  }
);

const mockRouter = async ({ method, path, payload }) => {
  if (method === "post" && path.startsWith("/activity.json/search")) {
    return mockProducts;
  }

  if (method === "get" && path.includes("/price-list")) {
    const productId = path.split("/activity.json/")[1]?.split("/")[0] || "";
    return mockPriceList(productId);
  }

  if (method === "get" && path.startsWith("/activity.json/")) {
    const productId = path.replace("/activity.json/", "").split("?")[0];
    return mockProducts.find((p) => p.id === productId) || null;
  }

  if (method === "post" && path === "/availability") {
    return mockAvailability(payload);
  }

  if (method === "post" && (path === "/booking-questions" || path.startsWith("/checkout.json/options/booking-request"))) {
    const activityBooking = payload?.activityBookings?.[0] || {};
    const questions = mockQuestions({ optionId: String(activityBooking.rateId || "") });
    return {
      checkoutOptions: [
        {
          type: "CUSTOMER_FULL_PAYMENT",
          questions
        }
      ]
    };
  }

  if (method === "post" && path === "/checkout.json/submit") {
    const mockBooking = mockBookingCreate(payload);
    return {
      booking: {
        bookingId: mockBooking.id || mockBooking.bookingId,
        confirmationCode: mockBooking.confirmationCode || mockBooking.bookingReference || "MOCK-CONFIRMED",
        externalBookingReference:
          payload?.directBooking?.externalBookingReference || mockBooking.bookingReference || "",
        status: "RESERVED",
        currency: payload?.currency || "USD",
        totalPrice: Number(payload?.amount || 0),
        totalPaid: 0,
        totalDue: Number(payload?.amount || 0)
      }
    };
  }

  if (method === "post" && path.startsWith("/checkout.json/confirm-reserved/")) {
    const code = decodeURIComponent(path.split("/").pop() || "");
    return {
      booking: {
        bookingId: `mock_${code}`,
        confirmationCode: code,
        externalBookingReference: payload?.externalBookingReference || code,
        status: "CONFIRMED",
        currency: payload?.currency || "USD",
        totalPrice: Number(payload?.amount || 0),
        totalPaid: Number(payload?.amount || 0),
        totalDue: 0
      }
    };
  }

  if (method === "get" && path.startsWith("/bookings/")) {
    const reference = path.split("/").pop();
    return {
      id: `bokun_${reference}`,
      bookingReference: reference,
      status: "CONFIRMED"
    };
  }

  if (method === "post" && path.endsWith("/cancel")) {
    return { success: true, status: "CANCELLED" };
  }

  if (method === "post" && path.endsWith("/edit")) {
    return { success: true, status: "EDIT_REQUESTED" };
  }

  return null;
};

const request = async ({ method, path, payload = null, requestId = "", expectedNotFound = false }) => {
  if (shouldMock) {
    const mockResponse = await mockRouter({ method, path, payload });
    if (mockResponse === null) {
      throw new AppError("Mock Bokun route not found", 404, "BOKUN_MOCK_NOT_FOUND", { method, path });
    }

    return mockResponse;
  }

  ensureBokunConfigured();

  const normalizedMethod = String(method || "get").toLowerCase();
  const requestConfig = {
    method,
    url: path,
    bokunExpectedNotFound: Boolean(expectedNotFound),
    headers: {
      "x-request-id": requestId,
      ...(payload?.idempotencyKey ? { "Idempotency-Key": String(payload.idempotencyKey) } : {})
    }
  };

  if (!["get", "head", "delete"].includes(normalizedMethod) && payload !== null && payload !== undefined) {
    requestConfig.data = payload;
  }

  const response = await bokunAxios(requestConfig);

  return response.data;
};

module.exports = {
  request,
  shouldMock
};
