const { z } = require("zod");

const dateRangeFieldEnum = z.enum([
  "creationDateRange",
  "startDateRange",
  "lastModifiedDateRange",
  "cancellationDateRange"
]);

const importConfirmedBookingsSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z
    .object({
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
      maxPages: z.coerce.number().int().min(1).max(100).optional(),
      bookingStatuses: z.array(z.string().min(1)).optional(),
      dateRangeField: dateRangeFieldEnum.optional(),
      fromDate: z.string().min(1).optional(),
      toDate: z.string().min(1).optional(),
      filters: z.record(z.any()).optional(),
      dryRun: z.boolean().optional()
    })
    .optional()
});

const resyncBokunBookingSchema = z.object({
  params: z.object({
    reference: z.string().min(1).max(160)
  }),
  query: z.object({}).optional(),
  body: z
    .object({
      dryRun: z.boolean().optional()
    })
    .optional()
});

module.exports = {
  importConfirmedBookingsSchema,
  resyncBokunBookingSchema
};
