const { z } = require("zod");
const BookingRequest = require("../models/BookingRequest");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const pageFields = {
  page: z.coerce.number().int().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
};
const requestIdParams = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i, "Invalid request id") });

const listBookingsSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({
    ...pageFields,
    origin: z.enum(["WEBSITE", "AGENT_PORTAL"]).optional(),
    bookingStatus: z.enum(["pending", "confirmed", "cancelled", "failed", "edit_requested"]).optional(),
    paymentStatus: z.string().regex(/^[a-z_]{2,32}$/).optional(),
    supplierStatus: z.string().regex(/^[a-z_]{2,40}$/).optional(),
    travelDateFrom: isoDate.optional(),
    travelDateTo: isoDate.optional(),
    search: z.string().trim().min(3).max(254).optional()
  }).strict()
});

const listRequestsSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({
    ...pageFields,
    type: z.enum(["reschedule", "change_travelers", "cancel_booking", "combined_change"]).optional(),
    customerStatus: z.enum(BookingRequest.REQUEST_STATUS_VALUES).optional(),
    state: z.enum(BookingRequest.OPERATIONS_STATE_VALUES).optional(),
    category: z.enum(BookingRequest.OPERATIONS_CATEGORY_VALUES).optional(),
    bookingReference: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/).optional()
  }).strict()
});

const requestIdSchema = z.object({
  body: z.object({}).optional(),
  params: requestIdParams,
  query: z.object({}).optional()
});

const noteSchema = z.object({
  body: z.object({ text: z.string().trim().min(1).max(2000) }).strict(),
  params: requestIdParams,
  query: z.object({}).optional()
});

const transitionSchema = z.object({
  body: z.object({
    toState: z.enum(BookingRequest.OPERATIONS_STATE_VALUES),
    expectedVersion: z.number().int().min(0),
    reason: z.string().trim().max(2000).optional().default("")
  }).strict(),
  params: requestIdParams,
  query: z.object({}).optional()
});

const categorySchema = z.object({
  body: z.object({
    category: z.enum(BookingRequest.OPERATIONS_CATEGORY_VALUES),
    expectedVersion: z.number().int().min(0)
  }).strict(),
  params: requestIdParams,
  query: z.object({}).optional()
});

module.exports = { listBookingsSchema, listRequestsSchema, requestIdSchema, noteSchema, transitionSchema, categorySchema };
