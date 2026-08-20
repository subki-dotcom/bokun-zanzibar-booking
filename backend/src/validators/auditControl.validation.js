const { z } = require("zod");

const optionalToken = z.string().min(1).max(180).optional();
const optionalDate = z.string().min(1).max(80).optional();
const paginationShape = {
  page: z.coerce.number().int().min(1).max(10000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
};

const auditFilterShape = {
  action: optionalToken,
  entityType: optionalToken,
  entityId: optionalToken,
  actorId: optionalToken,
  actorRole: optionalToken,
  reference: optionalToken,
  fromDate: optionalDate,
  toDate: optionalDate
};

const summaryQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z.object({
    fromDate: optionalDate,
    toDate: optionalDate
  }).optional()
});

const auditControlQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z.object({
    ...auditFilterShape,
    ...paginationShape
  }).optional()
});

const financialChangesQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z.object({
    ...auditFilterShape,
    minAmount: z.coerce.number().finite().optional(),
    maxAmount: z.coerce.number().finite().optional(),
    ...paginationShape
  }).optional()
});

module.exports = {
  auditControlQuerySchema,
  financialChangesQuerySchema,
  summaryQuerySchema
};
