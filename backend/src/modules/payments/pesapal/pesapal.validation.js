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

const bookingQuestionAnswerSchema = z.object({
  questionId: z.string().min(1),
  label: z.string().min(1),
  scope: z.enum(["booking", "passenger"]).default("booking"),
  passengerIndex: z.number().int().min(0).nullable().optional(),
  answer: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])
});

const customerSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(6),
  country: z.string().optional(),
  hotelName: z.string().optional(),
  notes: z.string().optional()
});

const createPesapalSchema = z.object({
  body: z
    .object({
      bookingId: z.string().min(3).optional(),
      amount: z.number().min(0).optional(),
      currency: z.string().min(3).max(3).optional(),
      quoteToken: z.string().min(10).optional(),
      productId: z.string().min(2).optional(),
      optionId: z.string().min(2).optional(),
      travelDate: z.string().min(8).optional(),
      startTime: z.string().optional(),
      priceCatalogId: z.string().min(1).optional(),
      pax: paxSchema.optional(),
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
      customer: customerSchema.optional(),
      bookingQuestions: z.array(bookingQuestionAnswerSchema).optional(),
      commissionManualPercent: z.number().min(0).max(100).optional(),
      paymentMethod: z.string().optional()
    })
    .superRefine((body, ctx) => {
      if (body.bookingId) {
        return;
      }

      const requiredFields = [
        "quoteToken",
        "productId",
        "optionId",
        "travelDate",
        "customer",
        "pax"
      ];

      requiredFields.forEach((field) => {
        if (!body[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${field} is required when bookingId is not provided`,
            path: [field]
          });
        }
      });

      const paxTotal =
        Number(body.pax?.adults || 0) +
        Number(body.pax?.children || 0) +
        Number(body.pax?.infants || 0);
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

const paymentSuccessSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z
    .object({
      OrderTrackingId: z.string().optional(),
      orderTrackingId: z.string().optional(),
      OrderMerchantReference: z.string().optional(),
      orderMerchantReference: z.string().optional()
    })
    .superRefine((query, ctx) => {
      const orderTrackingId = query.OrderTrackingId || query.orderTrackingId || "";
      const merchantReference = query.OrderMerchantReference || query.orderMerchantReference || "";

      if (!orderTrackingId && !merchantReference) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "OrderTrackingId or OrderMerchantReference is required",
          path: ["OrderTrackingId"]
        });
      }
    })
});

const paymentCancelSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({
    OrderTrackingId: z.string().optional(),
    orderTrackingId: z.string().optional(),
    OrderMerchantReference: z.string().optional(),
    orderMerchantReference: z.string().optional(),
    bookingId: z.string().optional()
  })
});

module.exports = {
  createPesapalSchema,
  paymentSuccessSchema,
  paymentCancelSchema
};
