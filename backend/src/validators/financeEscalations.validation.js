const { z } = require("zod");
const BookingRequest = require("../models/BookingRequest");

const reference = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/);

const listEscalationsSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({
    page: z.coerce.number().int().min(1).max(1000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    // "awaiting": currently escalated to Finance (default). "all": ever escalated to Finance.
    scope: z.enum(["awaiting", "all"]).optional(),
    type: z.enum(["reschedule", "change_travelers", "cancel_booking", "combined_change"]).optional(),
    category: z.enum(BookingRequest.OPERATIONS_CATEGORY_VALUES).optional(),
    bookingReference: reference.optional(),
    requestReference: reference.optional()
  }).strict()
});

const escalationIdSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i, "Invalid request id") }),
  query: z.object({}).optional()
});

module.exports = { listEscalationsSchema, escalationIdSchema };
