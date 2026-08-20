const { z } = require("zod");

const productionReadinessSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({}).optional()
});

module.exports = {
  productionReadinessSchema
};
