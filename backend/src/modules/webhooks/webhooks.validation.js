const { z } = require("zod");

const pollBookingSyncSchema = z.object({
  body: z
    .object({
      limit: z.number().int().min(1).max(100).optional()
    })
    .default({}),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

module.exports = {
  pollBookingSyncSchema
};
