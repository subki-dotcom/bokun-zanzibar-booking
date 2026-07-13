const { z } = require("zod");

const bookingReferenceParam = z.object({
  bookingReference: z.string().min(3)
});

const listReconciliationSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      limit: z.coerce.number().int().min(1).max(200).optional()
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
