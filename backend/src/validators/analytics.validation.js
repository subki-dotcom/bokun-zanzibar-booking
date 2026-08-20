const { z } = require("zod");
const {
  ANALYTICS_COMPARE_MODE,
  ANALYTICS_DATE_DIMENSION,
  ANALYTICS_GRANULARITY,
  ANALYTICS_PERIOD
} = require("../analytics/constants");
const { SALES_CHANNEL } = require("../integrations/bokun/salesChannel.adapter");

const periodEnum = z.enum(Object.values(ANALYTICS_PERIOD));
const compareModeEnum = z.enum(Object.values(ANALYTICS_COMPARE_MODE));
const dateDimensionEnum = z.enum(Object.values(ANALYTICS_DATE_DIMENSION));
const granularityEnum = z.enum(Object.values(ANALYTICS_GRANULARITY));
const salesChannelEnum = z.enum(Object.values(SALES_CHANNEL));

const executiveAnalyticsQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      period: periodEnum.optional(),
      from: z.string().min(1).optional(),
      to: z.string().min(1).optional(),
      compare: compareModeEnum.optional(),
      compareFrom: z.string().min(1).optional(),
      compareTo: z.string().min(1).optional(),
      dateDimension: dateDimensionEnum.optional(),
      operationalDateDimension: dateDimensionEnum.optional()
    })
    .optional()
});

const salesAnalyticsQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      period: periodEnum.optional(),
      from: z.string().min(1).optional(),
      to: z.string().min(1).optional(),
      compare: compareModeEnum.optional(),
      compareFrom: z.string().min(1).optional(),
      compareTo: z.string().min(1).optional(),
      dateDimension: dateDimensionEnum.optional(),
      granularity: granularityEnum.optional(),
      channel: salesChannelEnum.optional(),
      productId: z.string().min(1).max(180).optional()
    })
    .optional()
});

const productAnalyticsQuerySchema = z.object({
  params: z
    .object({
      productId: z.string().min(1).max(180).optional()
    })
    .optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      period: periodEnum.optional(),
      from: z.string().min(1).optional(),
      to: z.string().min(1).optional(),
      compare: compareModeEnum.optional(),
      compareFrom: z.string().min(1).optional(),
      compareTo: z.string().min(1).optional(),
      dateDimension: dateDimensionEnum.optional(),
      channel: salesChannelEnum.optional(),
      productId: z.string().min(1).max(180).optional()
    })
    .optional()
});

const channelAnalyticsQuerySchema = z.object({
  params: z
    .object({
      channel: salesChannelEnum.optional()
    })
    .optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      period: periodEnum.optional(),
      from: z.string().min(1).optional(),
      to: z.string().min(1).optional(),
      compare: compareModeEnum.optional(),
      compareFrom: z.string().min(1).optional(),
      compareTo: z.string().min(1).optional(),
      dateDimension: dateDimensionEnum.optional(),
      channel: salesChannelEnum.optional(),
      productId: z.string().min(1).max(180).optional()
    })
    .optional()
});

const trendAnalyticsQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      period: periodEnum.optional(),
      from: z.string().min(1).optional(),
      to: z.string().min(1).optional(),
      compare: compareModeEnum.optional(),
      compareFrom: z.string().min(1).optional(),
      compareTo: z.string().min(1).optional(),
      granularity: granularityEnum.optional(),
      financialDateDimension: dateDimensionEnum.optional(),
      operationalDateDimension: dateDimensionEnum.optional(),
      channel: salesChannelEnum.optional(),
      productId: z.string().min(1).max(180).optional()
    })
    .optional()
});

module.exports = {
  channelAnalyticsQuerySchema,
  executiveAnalyticsQuerySchema,
  productAnalyticsQuerySchema,
  salesAnalyticsQuerySchema,
  trendAnalyticsQuerySchema
};
