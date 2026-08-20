const { z } = require("zod");
const {
  DATA_QUALITY_ISSUE,
  DATA_QUALITY_SEVERITY
} = require("../services/dataQuality");

const optionalDate = z.string().min(1).max(80).optional();
const optionalToken = z.string().min(1).max(180).optional();
const severityEnum = z.enum(Object.values(DATA_QUALITY_SEVERITY));
const issueCodeEnum = z.enum(Object.values(DATA_QUALITY_ISSUE));

const scanShape = {
  fromDate: optionalDate,
  toDate: optionalDate,
  limit: z.coerce.number().int().min(1).max(5000).optional()
};

const dataQualitySummaryQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z.object(scanShape).optional()
});

const dataQualityIssueQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      ...scanShape,
      severity: severityEnum.optional(),
      code: issueCodeEnum.optional(),
      entityType: optionalToken,
      reference: optionalToken,
      issueLimit: z.coerce.number().int().min(1).max(500).optional()
    })
    .optional()
});

module.exports = {
  dataQualityIssueQuerySchema,
  dataQualitySummaryQuerySchema
};
