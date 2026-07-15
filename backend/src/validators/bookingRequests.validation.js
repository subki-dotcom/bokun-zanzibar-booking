const { z } = require("zod");

const requestTypes = ["reschedule", "change_travelers", "cancel_booking", "combined_change"];
const requestStatuses = ["submitted", "under_review", "awaiting_customer_information", "awaiting_availability_check", "awaiting_additional_payment", "approved", "rejected", "processing", "completed", "cancelled_by_customer", "failed"];
const refundStatuses = ["pending_approval", "approved", "processing", "partially_refunded", "refunded", "failed", "rejected", "cancelled", "manual_review"];
const bokunStatuses = ["pending", "checking_availability", "available", "unavailable", "syncing", "synced", "failed", "manual_action_required"];

const mongoObjectId = z.string().regex(/^[a-f\d]{24}$/i, "A valid record ID is required");
const idParams = z.object({ id: mongoObjectId });
const emailQuery = z.object({ customerEmail: z.string().email() });
const travelers = z.object({
  adults: z.number().int().min(0),
  children: z.number().int().min(0).default(0),
  infants: z.number().int().min(0).default(0),
  childAges: z.array(z.number().int().min(0).max(17)).max(20).optional()
});

const submitBookingRequestSchema = z.object({
  params: z.object({ bookingId: mongoObjectId }),
  body: z.object({
    customerEmail: z.string().email(),
    type: z.enum(requestTypes),
    requestedChanges: z.object({
      date: z.string().min(8).optional(),
      startTime: z.string().max(20).optional(),
      travelers: travelers.optional()
    }).default({}),
    customerReason: z.string().min(3).max(1500),
    customerNotes: z.string().max(2500).optional(),
    cancellationReason: z.enum(["change_of_plans", "flight_cancellation", "flight_delay", "medical_reason", "weather_concern", "booked_by_mistake", "duplicate_booking", "other"]).optional(),
    cancellationConfirmed: z.boolean().optional(),
    attachments: z.array(z.object({ name: z.string().min(1).max(180), url: z.string().url().max(1000) })).max(5).optional()
  }),
  query: z.object({}).optional()
});

const customerRequestQuerySchema = z.object({ params: idParams, query: emailQuery, body: z.object({}).optional() });
const cancellationEstimateSchema = z.object({ params: z.object({ bookingId: mongoObjectId }), query: emailQuery, body: z.object({}).optional() });
const customerRequestResponseSchema = z.object({ params: idParams, query: z.object({}).optional(), body: z.object({ customerEmail: z.string().email(), notes: z.string().min(2).max(2500) }) });
const customerRequestCancelSchema = z.object({ params: idParams, query: z.object({}).optional(), body: z.object({ customerEmail: z.string().email() }) });

const adminRequestListSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z.object({
    type: z.enum(requestTypes).optional(),
    status: z.enum(requestStatuses).optional(),
    refundStatus: z.enum(["not_required", ...refundStatuses]).optional(),
    bokunStatus: z.enum(["not_required", ...bokunStatuses]).optional(),
    search: z.string().max(180).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional()
  }).optional()
});

const adminRequestIdSchema = z.object({ params: idParams, query: z.object({}).optional(), body: z.object({}).optional() });
const adminApproveSchema = z.object({
  params: idParams,
  query: z.object({}).optional(),
  body: z.object({
    customerFacingReason: z.string().max(1500).optional(),
    internalNote: z.string().max(2500).optional(),
    overrideAmount: z.number().finite().optional(),
    overrideReason: z.string().max(1500).optional(),
    refundAmount: z.number().min(0).optional(),
    refundProvider: z.enum(["pesapal", "dpo", "paypal", "manual_bank_transfer", "cash", "other"]).optional(),
    refundReason: z.string().max(1500).optional(),
    paymentProvider: z.enum(["pesapal", "dpo", "paypal", "manual_bank_transfer", "cash", "other"]).optional()
  }).default({})
});
const adminDecisionSchema = z.object({ params: idParams, query: z.object({}).optional(), body: z.object({ customerFacingReason: z.string().min(3).max(1500), internalNote: z.string().max(2500).optional() }) });
const adjustmentPaidSchema = z.object({ params: idParams, query: z.object({}).optional(), body: z.object({ paymentReference: z.string().max(200).optional() }) });
const refundStatusSchema = z.object({ params: idParams, query: z.object({}).optional(), body: z.object({ status: z.enum(refundStatuses), providerRefundReference: z.string().max(200).optional(), failureReason: z.string().max(1000).optional() }) });

module.exports = {
  submitBookingRequestSchema,
  customerRequestQuerySchema,
  cancellationEstimateSchema,
  customerRequestResponseSchema,
  customerRequestCancelSchema,
  adminRequestListSchema,
  adminRequestIdSchema,
  adminApproveSchema,
  adminDecisionSchema,
  adjustmentPaidSchema,
  refundStatusSchema
};
