const { z } = require("zod");

const bookingReferenceParam = z.object({
  bookingReference: z.string().min(3)
});

const listReconciliationSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      search: z.string().max(120).optional(),
      fromDate: z.string().date().optional(),
      toDate: z.string().date().optional(),
      channel: z.string().max(80).optional(),
      paymentStatus: z.string().max(40).optional(),
      settlementStatus: z.string().max(40).optional(),
      reconciliationStatus: z.string().max(40).optional(),
      currency: z.string().length(3).optional(),
      status: z.string().max(40).optional(),
      sort: z.string().max(40).optional(),
      order: z.enum(["asc", "desc"]).optional()
    })
    .optional()
});

const bookingReferenceActionSchema = z.object({
  params: bookingReferenceParam,
  body: z.object({}).optional(),
  query: z.object({}).optional()
});

const retryBokunFinalizationSchema = z.object({
  params: bookingReferenceParam,
  body: z.object({
    bookingId: z.string().min(3),
    force: z.boolean().optional()
  }),
  query: z.object({}).optional()
});

const markReviewedSchema = z.object({
  params: bookingReferenceParam,
  body: z
    .object({
      reviewNote: z.string().max(500).optional()
    })
    .optional(),
  query: z.object({}).optional()
});

module.exports = {
  listReconciliationSchema,
  bookingReferenceActionSchema,
  retryBokunFinalizationSchema,
  markReviewedSchema
};
