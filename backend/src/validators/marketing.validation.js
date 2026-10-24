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

// The contact page form. "website" is a field people never see; robots fill it in.
const contactMessageSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(160),
    phone: z.string().trim().max(50).optional().default(""),
    travelDate: z.string().trim().max(40).optional().default(""),
    message: z.string().trim().min(5).max(2000),
    website: z.string().max(200).optional().default("")
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

module.exports = { captureLeadSchema, contactMessageSchema };
