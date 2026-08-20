const { z } = require("zod");
const {
  ANALYTICS_COMPARE_MODE,
  ANALYTICS_DATE_DIMENSION,
  ANALYTICS_GRANULARITY,
  ANALYTICS_PERIOD
} = require("../analytics/constants");
const { SALES_CHANNEL } = require("../integrations/bokun/salesChannel.adapter");
const {
  EXPENSE_CATEGORY,
  EXPENSE_PAYMENT_STATUS,
  FINANCIAL_ENTRY_STATUS,
  INCOME_CATEGORY
} = require("../accounting/constants");
const { REPORT_EXPORT_FORMAT, REPORT_TYPE } = require("../reportCenter/constants");

const periodEnum = z.enum(Object.values(ANALYTICS_PERIOD));
const compareModeEnum = z.enum(Object.values(ANALYTICS_COMPARE_MODE));
const dateDimensionEnum = z.enum(Object.values(ANALYTICS_DATE_DIMENSION));
const granularityEnum = z.enum(Object.values(ANALYTICS_GRANULARITY));
const salesChannelEnum = z.enum(Object.values(SALES_CHANNEL));
const reportTypeEnum = z.enum(Object.values(REPORT_TYPE));
const exportFormatEnum = z.enum(Object.values(REPORT_EXPORT_FORMAT));
const expenseCategoryEnum = z.enum(Object.values(EXPENSE_CATEGORY));
const expensePaymentStatusEnum = z.enum(Object.values(EXPENSE_PAYMENT_STATUS));
const financialEntryStatusEnum = z.enum(Object.values(FINANCIAL_ENTRY_STATUS));
const incomeCategoryEnum = z.enum(Object.values(INCOME_CATEGORY));

const optionalToken = z.string().min(1).max(180).optional();
const optionalDate = z.string().min(1).max(80).optional();

const reportCatalogQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z.object({}).optional()
});

const reportFilterQueryShape = {
  period: periodEnum.optional(),
  from: optionalDate,
  to: optionalDate,
  compare: compareModeEnum.optional(),
  compareFrom: optionalDate,
  compareTo: optionalDate,
  dateDimension: dateDimensionEnum.optional(),
  financialDateDimension: dateDimensionEnum.optional(),
  operationalDateDimension: dateDimensionEnum.optional(),
  granularity: granularityEnum.optional(),
  currency: z.string().length(3).optional(),
  productId: optionalToken,
  productOptionId: optionalToken,
  channel: salesChannelEnum.optional(),
  agentId: optionalToken,
  customerId: optionalToken,
  supplierId: optionalToken,
  vehicleId: optionalToken,
  driverId: optionalToken,
  guideId: optionalToken,
  businessUnit: optionalToken,
  bookingStatus: optionalToken,
  paymentStatus: optionalToken,
  refundStatus: optionalToken,
  profitabilityStatus: optionalToken,
  expenseCategory: expenseCategoryEnum.optional(),
  incomeCategory: incomeCategoryEnum.optional(),
  status: financialEntryStatusEnum.optional(),
  expensePaymentStatus: expensePaymentStatusEnum.optional()
};

const runReportQuerySchema = z.object({
  params: z.object({
    reportType: reportTypeEnum
  }),
  body: z.object({}).optional(),
  query: z.object(reportFilterQueryShape).optional()
});

const exportReportQuerySchema = z.object({
  params: z.object({
    reportType: reportTypeEnum
  }),
  body: z.object({}).optional(),
  query: z.object({
    ...reportFilterQueryShape,
    format: exportFormatEnum
  })
});

const exportHistoryQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      reportType: reportTypeEnum.optional(),
      format: exportFormatEnum.optional(),
      limit: z.coerce.number().int().min(1).max(200).optional()
    })
    .optional()
});

module.exports = {
  exportHistoryQuerySchema,
  exportReportQuerySchema,
  reportCatalogQuerySchema,
  runReportQuerySchema
};
