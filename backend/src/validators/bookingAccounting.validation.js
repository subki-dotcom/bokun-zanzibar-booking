const { z } = require("zod");

const optionalToken = z.string().min(1).max(180).optional();
const optionalDate = z.string().min(1).max(80).optional();
const optionalStatus = z.string().min(1).max(80).optional();

const bookingAccountingQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).max(10000).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      search: optionalToken,
      status: optionalStatus,
      provider: optionalStatus,
      category: optionalStatus,
      severity: optionalStatus,
      fromDate: optionalDate,
      toDate: optionalDate
    })
    .optional()
});

module.exports = {
  bookingAccountingQuerySchema
};
