const { z } = require("zod");

const availabilitySearchSchema = z.object({
  body: z.object({
    travelDate: z.string().min(8),
    pax: z.object({
      adults: z.number().int().min(1).max(50),
      children: z.number().int().min(0).max(50).default(0),
      infants: z.number().int().min(0).max(50).default(0)
    }).default({ adults: 1, children: 0, infants: 0 }),
    slugs: z.array(z.string().min(1)).min(1).max(12)
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

module.exports = {
  availabilitySearchSchema
};
