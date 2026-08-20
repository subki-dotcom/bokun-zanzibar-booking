const { z } = require("zod");
const {
  ALERT_CATEGORY,
  ALERT_SEVERITY,
  ALERT_STATE,
  FAILED_JOB_TYPE
} = require("../services/opsControl");

const optionalToken = z.string().min(1).max(240).optional();
const optionalDate = z.string().min(1).max(80).optional();
const paginationShape = {
  page: z.coerce.number().int().min(1).max(10000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
};

const commonQueryShape = {
  fromDate: optionalDate,
  toDate: optionalDate,
  reference: optionalToken,
  category: z.enum(Object.values(ALERT_CATEGORY)).optional(),
  ...paginationShape
};

const opsControlSummaryQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z.object({
    fromDate: optionalDate,
    toDate: optionalDate
  }).optional()
});

const systemAlertsQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z.object({
    ...commonQueryShape,
    state: z.enum(Object.values(ALERT_STATE)).optional(),
    severity: z.enum(Object.values(ALERT_SEVERITY)).optional(),
    includeClosed: z.enum(["true", "false"]).optional(),
    dataQualityScanLimit: z.coerce.number().int().min(1).max(5000).optional(),
    dataQualityIssueLimit: z.coerce.number().int().min(1).max(500).optional()
  }).optional()
});

const failedJobsQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z.object({
    ...commonQueryShape,
    status: optionalToken,
    jobType: z.enum(Object.values(FAILED_JOB_TYPE)).optional(),
    scanLimit: z.coerce.number().int().min(1).max(500).optional()
  }).optional()
});

const idParams = z.object({
  id: z.string().min(3).max(260)
});

const alertActionSchema = z.object({
  params: idParams,
  body: z.object({}).optional(),
  query: z.object({}).optional()
});

const alertResolveSchema = z.object({
  params: idParams,
  body: z.object({
    resolutionNote: z.string().max(2000).optional()
  }).default({}),
  query: z.object({}).optional()
});

const failedJobRetrySchema = z.object({
  params: idParams,
  body: z.object({
    force: z.boolean().optional()
  }).default({}),
  query: z.object({}).optional()
});

module.exports = {
  alertActionSchema,
  alertResolveSchema,
  failedJobRetrySchema,
  failedJobsQuerySchema,
  opsControlSummaryQuerySchema,
  systemAlertsQuerySchema
};
