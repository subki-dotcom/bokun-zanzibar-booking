const {
  channelAnalyticsService,
  executiveAnalyticsService,
  productAnalyticsService,
  salesAnalyticsService,
  trendAnalyticsService
} = require("../analytics");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");

const executive = asyncHandler(async (req, res) => {
  const data = await executiveAnalyticsService.getExecutiveDashboard(req.validated?.query || {});
  return successResponse(res, {
    message: "Executive analytics fetched",
    data
  });
});

const sales = asyncHandler(async (req, res) => {
  const data = await salesAnalyticsService.getSalesAnalytics(req.validated?.query || {});
  return successResponse(res, {
    message: "Sales analytics fetched",
    data
  });
});

const products = asyncHandler(async (req, res) => {
  const data = await productAnalyticsService.getProductAnalytics({
    ...(req.validated?.query || {}),
    productId: req.validated?.params?.productId || req.validated?.query?.productId || ""
  });
  return successResponse(res, {
    message: "Product analytics fetched",
    data
  });
});

const channels = asyncHandler(async (req, res) => {
  const data = await channelAnalyticsService.getChannelAnalytics({
    ...(req.validated?.query || {}),
    channel: req.validated?.params?.channel || req.validated?.query?.channel || ""
  });
  return successResponse(res, {
    message: "Channel analytics fetched",
    data
  });
});

const trends = asyncHandler(async (req, res) => {
  const data = await trendAnalyticsService.getTrendAnalytics(req.validated?.query || {});
  return successResponse(res, {
    message: "Trend analytics fetched",
    data
  });
});

module.exports = {
  channels,
  executive,
  products,
  sales,
  trends
};
