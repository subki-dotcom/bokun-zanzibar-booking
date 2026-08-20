const { z } = require("zod");

const systemHealthSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({}).optional()
});

module.exports = {
  systemHealthSchema
};
