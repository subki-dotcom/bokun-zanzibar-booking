const { z } = require("zod");

const paxSchema = z.object({
  adults: z.number().int().min(0),
  children: z.number().int().min(0).default(0),
  infants: z.number().int().min(0).default(0)
});

const priceCategoryParticipantSchema = z.object({
  categoryId: z.string().min(1),
  title: z.string().optional(),
  ticketCategory: z.string().optional(),
  quantity: z.number().int().min(0)
});

const quoteSchema = z.object({
  body: z.object({
    productId: z.string().min(2),
    optionId: z.string().min(2),
    travelDate: z.string().min(8),
    startTime: z.string().optional(),
    priceCatalogId: z.string().min(1).optional(),
    pax: paxSchema,
    priceCategoryParticipants: z.array(priceCategoryParticipantSchema).optional(),
    extras: z
      .array(
        z.object({
          code: z.string(),
          label: z.string(),
          quantity: z.number().int().min(1),
          amount: z.number().min(0)
        })
      )
      .optional(),
    promoCode: z.string().optional(),
    sourceChannel: z.string().optional()
  }).superRefine((body, ctx) => {
    const paxTotal = Number(body.pax?.adults || 0) + Number(body.pax?.children || 0) + Number(body.pax?.infants || 0);
    const categoryTotal = (body.priceCategoryParticipants || []).reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );

    if (paxTotal < 1 && categoryTotal < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one passenger is required",
        path: ["pax"]
      });
    }
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

const bookingQuestionAnswerSchema = z.object({
  questionId: z.string().min(1),
  label: z.string().min(1),
  scope: z.enum(["booking", "passenger"]).default("booking"),
  passengerIndex: z.number().int().min(0).nullable().optional(),
  answer: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])
});

const createBookingSchema = z.object({
  body: z.object({
    quoteToken: z.string().min(10),
    productId: z.string().min(2),
    optionId: z.string().min(2),
    travelDate: z.string().min(8),
    startTime: z.string().optional(),
    priceCatalogId: z.string().min(1).optional(),
    pax: paxSchema,
    priceCategoryParticipants: z.array(priceCategoryParticipantSchema).optional(),
    extras: z
      .array(
        z.object({
          code: z.string(),
          label: z.string(),
          quantity: z.number().int().min(1),
          amount: z.number().min(0)
        })
      )
      .optional(),
    promoCode: z.string().optional(),
    customer: z.object({
      firstName: z.string().min(2),
      lastName: z.string().min(2),
      email: z.string().email(),
      phone: z.string().min(6),
      country: z.string().optional(),
      hotelName: z.string().optional(),
      notes: z.string().optional()
    }),
    bookingQuestions: z.array(bookingQuestionAnswerSchema).default([]),
    commissionManualPercent: z.number().min(0).max(100).optional(),
    paymentMethod: z.string().optional()
  }).superRefine((body, ctx) => {
    const paxTotal = Number(body.pax?.adults || 0) + Number(body.pax?.children || 0) + Number(body.pax?.infants || 0);
    const categoryTotal = (body.priceCategoryParticipants || []).reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );

    if (paxTotal < 1 && categoryTotal < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one passenger is required",
        path: ["pax"]
      });
    }
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

const cancelBookingSchema = z.object({
  body: z.object({
    reason: z.string().min(3)
  }),
  params: z.object({
    id: z.string().min(3)
  }),
  query: z.object({}).optional()
});

const editBookingSchema = z.object({
  body: z.object({
    reason: z.string().min(3),
    payload: z.record(z.any())
  }),
  params: z.object({
    id: z.string().min(3)
  }),
  query: z.object({}).optional()
});

const listPendingFinalizationsSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    includeProcessing: z.enum(["true", "false"]).optional(),
    force: z.enum(["true", "false"]).optional()
  }).optional()
});

const retryFinalizationSchema = z.object({
  params: z.object({
    id: z.string().min(3)
  }),
  body: z.object({
    force: z.boolean().optional()
  }).optional(),
  query: z.object({}).optional()
});

const reconcileFinalizationsSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({
    limit: z.number().int().min(1).max(200).optional(),
    force: z.boolean().optional()
  }).optional(),
  query: z.object({}).optional()
});

module.exports = {
  quoteSchema,
  createBookingSchema,
  cancelBookingSchema,
  editBookingSchema,
  listPendingFinalizationsSchema,
  retryFinalizationSchema,
  reconcileFinalizationsSchema
};
