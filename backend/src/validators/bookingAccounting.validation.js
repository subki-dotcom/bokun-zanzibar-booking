const { z } = require("zod");

const optionalToken = z.string().min(1).max(180).optional();
const optionalDate = z.string().min(1).max(80).optional();
const optionalStatus = z.string().min(1).max(80).optional();
const requiredToken = z.string().trim().min(1).max(240);

const optionalNullableNumber = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : Number(value)),
  z.number().min(0).nullable().optional()
);

const costTierSchema = z.object({
  min: z.coerce.number().min(0).optional(),
  max: optionalNullableNumber,
  amount: z.coerce.number().min(0)
});

const costLineSchema = z.object({
  lineId: z.string().max(120).optional(),
  category: requiredToken,
  expenseCategory: z.string().max(120).optional(),
  description: z.string().max(500).optional(),
  basis: requiredToken,
  appliesTo: z.string().max(120).optional(),
  amount: z.coerce.number().min(0).optional(),
  percentage: z.coerce.number().min(0).max(1000).optional(),
  percentageBase: z.string().max(120).optional(),
  tiers: z.array(costTierSchema).max(40).optional(),
  supplierId: z.any().optional(),
  notes: z.string().max(1000).optional(),
  sortOrder: z.coerce.number().int().min(0).optional()
});

const bookingAccountingQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).max(10000).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      search: optionalToken,
      status: optionalStatus,
      templateStatus: optionalStatus,
      costStatus: optionalStatus,
      view: optionalStatus,
      tab: optionalStatus,
      dateRange: optionalStatus,
      channel: optionalStatus,
      salesChannel: optionalStatus,
      provider: optionalStatus,
      category: optionalStatus,
      severity: optionalStatus,
      productId: optionalToken,
      optionId: optionalToken,
      bokunProductId: optionalToken,
      bokunOptionId: optionalToken,
      currency: optionalStatus,
      fromDate: optionalDate,
      toDate: optionalDate
    })
    .optional()
});

const costTemplateParamsSchema = z.object({
  params: z.object({
    templateId: requiredToken
  }),
  body: z.object({}).optional(),
  query: z.object({}).optional()
});

const costTemplateWriteSchema = z.object({
  params: z
    .object({
      templateId: requiredToken.optional()
    })
    .optional(),
  query: z.object({}).optional(),
  body: z.object({
    bokunProductId: requiredToken,
    bokunOptionId: requiredToken,
    pricingCategoryId: z.string().max(180).optional(),
    pricingCategoryTitle: z.string().max(240).optional(),
    currency: z.string().trim().min(3).max(10),
    name: requiredToken,
    description: z.string().max(2000).optional(),
    internalNotes: z.string().max(4000).optional(),
    status: z.enum(["draft", "active", "inactive", "archived"]).optional(),
    validFrom: z.string().max(80).optional(),
    validTo: z.union([z.string().max(80), z.literal(""), z.null()]).optional(),
    costLines: z.array(costLineSchema).min(1).max(100)
  })
});

const archiveCostTemplateSchema = z.object({
  params: z.object({
    templateId: requiredToken
  }),
  query: z.object({}).optional(),
  body: z
    .object({
      reason: z.string().max(1000).optional()
    })
    .optional()
});

const costTemplatePreviewSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({
    templateId: z.string().max(180).optional(),
    currency: z.string().max(10).optional(),
    costLines: z.array(costLineSchema).max(100).optional(),
    context: z
      .object({
        adults: z.coerce.number().min(0).optional(),
        children: z.coerce.number().min(0).optional(),
        participants: z.coerce.number().min(0).optional(),
        vehicles: z.coerce.number().min(0).optional(),
        sellingAmount: z.coerce.number().min(0).optional(),
        currency: z.string().max(10).optional()
      })
      .optional(),
    adults: z.coerce.number().min(0).optional(),
    children: z.coerce.number().min(0).optional(),
    participants: z.coerce.number().min(0).optional(),
    vehicles: z.coerce.number().min(0).optional(),
    sellingAmount: z.coerce.number().min(0).optional()
  })
});

module.exports = {
  archiveCostTemplateSchema,
  bookingAccountingQuerySchema,
  costTemplateParamsSchema,
  costTemplatePreviewSchema,
  costTemplateWriteSchema
};
