const { z } = require("zod");
const { OPERATION_STATUS, OPERATION_TYPE } = require("../services/disasterRecovery");

const optionalToken = z.string().min(1).max(240).optional();

const disasterRecoverySummarySchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({}).optional()
});

const disasterRecoveryHistorySchema = z.object({
  params: z.object({}).optional(),
  query: z.object({
    type: z.enum(Object.values(OPERATION_TYPE)).optional(),
    status: z.enum(Object.values(OPERATION_STATUS)).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional()
  }).optional(),
  body: z.object({}).optional()
});

const backupPlanSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({
    label: optionalToken,
    reason: z.string().max(1000).optional()
  }).default({})
});

const restorePlanSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({
    archivePath: z.string().max(1000).optional(),
    targetUri: z.string().max(1500).optional(),
    sourceBackupOperationId: z.string().max(80).optional(),
    reason: z.string().max(1000).optional(),
    confirmRestore: z.boolean().optional(),
    allowProductionRestore: z.boolean().optional(),
    dropExisting: z.boolean().optional()
  }).default({})
});

module.exports = {
  backupPlanSchema,
  disasterRecoveryHistorySchema,
  disasterRecoverySummarySchema,
  restorePlanSchema
};
