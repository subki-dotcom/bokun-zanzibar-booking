const { z } = require("zod");

const reference = z.object({ reference: z.string().trim().min(3).max(80) });
const key = z.string().trim().min(8).max(200);

const paymentStatusSchema = z.object({
  body: z.object({}).optional(),
  params: reference,
  query: z.object({
    key,
    recheck: z.enum(["0", "1", "true", "false"]).optional()
  })
});

const paymentSessionSchema = z.object({
  body: z.object({
    key,
    provider: z.enum(["pesapal", "dpo", "paypal"]).optional()
  }),
  params: reference,
  query: z.object({}).optional()
});

module.exports = { paymentStatusSchema, paymentSessionSchema };
