const { z } = require("zod");

const createOfferSchema = z.object({
  body: z.object({
    name: z.string().min(3),
    code: z.string().min(3).max(20).optional(),
    description: z.string().optional(),
    discountType: z.enum(["percentage", "fixed"]),
    discountValue: z.number().positive(),
    automaticCampaign: z.boolean().optional(),
    productIds: z.array(z.string()).optional(),
    optionIds: z.array(z.string()).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    active: z.boolean().optional(),
    localSubsidyOnly: z.boolean().optional()
  }),
  query: z.object({}).optional(),
  params: z.object({}).optional()
});

module.exports = {
  createOfferSchema
};