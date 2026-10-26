const { z } = require("zod");

const reference = z.string().trim().min(3).max(60);
const referenceParams = z.object({ reference });
const empty = z.object({}).optional();

const lookupSchema = z.object({
  params: empty,
  query: empty,
  body: z.object({
    reference,
    email: z.string().trim().email().max(254),
    captchaToken: z.string().max(4096).optional()
  })
});

const openLinkSchema = z.object({ params: empty, query: empty, body: z.object({ token: z.string().trim().min(20).max(200) }) });
const paymentKeySessionSchema = z.object({ params: empty, query: empty, body: z.object({ reference, key: z.string().trim().min(8).max(200) }) });
const bookingSchema = z.object({ params: referenceParams, query: empty, body: z.object({}).passthrough().optional() });

const travelers = z.object({
  adults: z.number().int().min(0).max(50),
  children: z.number().int().min(0).max(50).default(0),
  infants: z.number().int().min(0).max(50).default(0),
  childAges: z.array(z.number().int().min(0).max(17)).max(20).optional()
});

const submitRequestSchema = z.object({
  params: referenceParams,
  query: empty,
  body: z.object({
    type: z.enum(["reschedule", "change_travelers", "cancel_booking"]),
    requestedChanges: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      startTime: z.string().max(20).optional(),
      travelers: travelers.optional()
    }).default({}),
    customerReason: z.string().trim().min(3).max(1500),
    customerNotes: z.string().max(2500).optional(),
    cancellationReason: z.enum(["change_of_plans", "flight_cancellation", "flight_delay", "medical_reason", "weather_concern", "booked_by_mistake", "duplicate_booking", "other"]).optional(),
    cancellationConfirmed: z.boolean().optional()
  })
});

const revealContactSchema = z.object({ params: referenceParams, query: empty, body: z.object({ code: z.string().trim().regex(/^\d{6}$/) }) });

module.exports = { lookupSchema, openLinkSchema, paymentKeySessionSchema, bookingSchema, submitRequestSchema, revealContactSchema };
