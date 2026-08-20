const constants = require("./constants");
const channelAnalyticsService = require("./channelAnalyticsService");
const dateDimensions = require("./dateDimensions");
const executiveAnalyticsService = require("./executiveAnalyticsService");
const periods = require("./periods");
const productAnalyticsService = require("./productAnalyticsService");
const salesAnalyticsService = require("./salesAnalyticsService");
const trendAnalyticsService = require("./trendAnalyticsService");

module.exports = {
  ...constants,
  channelAnalyticsService,
  ...dateDimensions,
  executiveAnalyticsService,
  ...periods,
  productAnalyticsService,
  salesAnalyticsService,
  trendAnalyticsService
};
