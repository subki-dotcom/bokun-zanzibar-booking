const { z } = require("zod");

const decimal = z.coerce.number().finite().positive();
const currency = z.string().trim().length(3);
const fx = z.object({ rate: decimal, source: z.string().trim().min(1).max(200), date: z.string().trim().min(8).max(40) });
const invoiceParams = z.object({ invoiceNumber: z.string().trim().min(1).max(80) });

const recordManualPaymentSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({
    invoiceNumber: z.string().trim().min(1).max(80),
    method: z.enum(["CASH", "BANK_TRANSFER", "MOBILE_MONEY"]),
    amount: decimal,
    currency,
    evidenceReference: z.string().trim().min(1).max(200),
    idempotencyKey: z.string().trim().min(1).max(200),
    receivedAt: z.string().trim().max(40).optional(),
    fx: fx.optional(),
    notes: z.string().max(2000).optional()
  })
});

const voidManualPaymentSchema = z.object({
  params: z.object({ paymentId: z.string().regex(/^[a-f\d]{24}$/i) }),
  query: z.object({}).optional(),
  body: z.object({ reason: z.string().trim().min(3).max(1000) })
});

const createStandaloneInvoiceSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({
    idempotencyKey: z.string().trim().min(1).max(200),
    currency,
    customer: z.object({ name: z.string().trim().min(1).max(200), email: z.string().email().optional(), phone: z.string().max(40).optional() }),
    description: z.string().max(500).optional(),
    dueDate: z.string().max(40).optional(),
    revenueMappingKey: z.enum(["OTHER_SERVICE_REVENUE", "TOUR_REVENUE", "TRANSFER_REVENUE"]).optional(),
    paymentTerms: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
    lines: z.array(z.object({ label: z.string().trim().min(1).max(300), quantity: z.coerce.number().positive().default(1), unitPrice: z.coerce.number().min(0) })).min(1).max(100)
  })
});

const confirmDeliverySchema = z.object({
  params: invoiceParams,
  query: z.object({}).optional(),
  body: z.object({
    evidenceReference: z.string().trim().min(1).max(200),
    deliveredAt: z.string().trim().max(40).optional(),
    note: z.string().max(2000).optional(),
    fx: fx.optional()
  })
});

const invoiceAdjustmentSchema = z.object({
  params: invoiceParams,
  query: z.object({}).optional(),
  body: z.object({
    type: z.enum(["CREDIT_NOTE", "DEBIT_NOTE"]),
    amount: decimal,
    currency,
    reason: z.string().trim().min(3).max(1000),
    dryRun: z.boolean().optional(),
    approvalId: z.string().trim().max(200).optional(),
    idempotencyKey: z.string().trim().max(200).optional()
  })
});

const confirmSupplierChangeSchema = z.object({
  params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }),
  query: z.object({}).optional(),
  body: z.object({ supplierReference: z.string().trim().min(1).max(200), evidenceNote: z.string().trim().min(3).max(2000) })
});

module.exports = {
  confirmDeliverySchema,
  confirmSupplierChangeSchema,
  createStandaloneInvoiceSchema,
  invoiceAdjustmentSchema,
  recordManualPaymentSchema,
  voidManualPaymentSchema
};
