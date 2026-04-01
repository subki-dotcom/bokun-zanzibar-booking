const { z } = require("zod");

const createAgentSchema = z.object({
  body: z.object({
    companyName: z.string().min(2),
    contactFirstName: z.string().min(2),
    contactLastName: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    phone: z.string().optional(),
    country: z.string().optional(),
    commissionPercent: z.number().min(0).max(100).optional(),
    productCommissionOverrides: z
      .array(
        z.object({
          bokunProductId: z.string(),
          percent: z.number().min(0).max(100)
        })
      )
      .optional(),
    optionCommissionOverrides: z
      .array(
        z.object({
          bokunOptionId: z.string(),
          percent: z.number().min(0).max(100)
        })
      )
      .optional(),
    notes: z.string().optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

module.exports = {
  createAgentSchema
};