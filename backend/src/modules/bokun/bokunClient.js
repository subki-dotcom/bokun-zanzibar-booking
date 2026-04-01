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

const shouldMock = env.BOKUN_MOCK_MODE || !isBokunConfigured;

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
    const statusCode = error.response?.status || 502;
    const details = error.response?.data || { message: error.message };

    logger.error("Bokun API error", {
      statusCode,
      details,
      url: error.config?.url
    });

    throw new AppError("Bokun API request failed", statusCode, "BOKUN_REQUEST_FAILED", details);
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

  if (method === "post" && path === "/booking-questions") {
    return mockQuestions(payload);
  }

  if (method === "post" && path === "/bookings") {
    return mockBookingCreate(payload);
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

const request = async ({ method, path, payload = null, requestId = "" }) => {
  if (shouldMock) {
    const mockResponse = await mockRouter({ method, path, payload });
    if (mockResponse === null) {
      throw new AppError("Mock Bokun route not found", 404, "BOKUN_MOCK_NOT_FOUND", { method, path });
    }

    return mockResponse;
  }

  const normalizedMethod = String(method || "get").toLowerCase();
  const requestConfig = {
    method,
    url: path,
    headers: {
      "x-request-id": requestId
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
