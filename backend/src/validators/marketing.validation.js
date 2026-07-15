const { z } = require("zod");

const captureLeadSchema = z.object({
  body: z.object({
    email: z.string().email(),
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    phone: z.string().max(50).optional(),
    stage: z.enum(["newsletter", "checkout_customer", "checkout_payment_started"]).default("newsletter"),
    source: z.string().max(80).optional(),
    newsletterConsent: z.boolean().optional(),
    recoveryConsent: z.boolean().optional(),
    context: z.record(z.any()).optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

module.exports = { captureLeadSchema };
