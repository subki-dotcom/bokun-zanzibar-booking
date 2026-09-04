const { z } = require("zod");
const {
  ACCOUNTING_SCOPE,
  BUSINESS_UNIT,
  EXPENSE_CATEGORY,
  EXPENSE_PAYMENT_STATUS,
  FINANCIAL_ENTRY_STATUS,
  INCOME_CATEGORY,
  SOURCE_MODULE
} = require("../accounting/constants");

const moneyInput = z.union([z.string().min(1), z.number().finite()]);
const optionalMoneyInput = z.union([z.string().min(1), z.number().finite()]).optional();
const mongoObjectId = z.string().regex(/^[a-f\d]{24}$/i, "A valid record ID is required");
const businessUnitEnum = z.enum(Object.values(BUSINESS_UNIT));
const expenseCategoryEnum = z.enum(Object.values(EXPENSE_CATEGORY));
const expensePaymentStatusEnum = z.enum(Object.values(EXPENSE_PAYMENT_STATUS));
const incomeCategoryEnum = z.enum(Object.values(INCOME_CATEGORY));
const accountingScopeEnum = z.enum(Object.values(ACCOUNTING_SCOPE));
const sourceModuleEnum = z.enum(Object.values(SOURCE_MODULE));
const financialStatusEnum = z.enum(Object.values(FINANCIAL_ENTRY_STATUS));

const foundationQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      fromDate: z.string().min(1).optional(),
      toDate: z.string().min(1).optional(),
      dateRange: z.string().min(1).max(80).optional()
    })
    .optional()
});

const postBookingContributionSchema = z.object({
  params: z.object({
    bookingReference: z.string().min(1).max(180)
  }),
  query: z.object({}).optional(),
  body: z
    .object({
      dryRun: z.boolean().optional(),
      reason: z.string().max(1000).optional()
    })
    .default({})
});

const counterpartySchema = z
  .object({
    name: z.string().max(180).optional(),
    email: z.union([z.string().email(), z.literal("")]).optional(),
    phone: z.string().max(80).optional(),
    type: z.string().max(80).optional()
  })
  .optional();

const supplierSchema = z
  .object({
    supplierId: z.string().max(180).optional(),
    name: z.string().max(180).optional(),
    type: z.string().max(80).optional(),
    contact: z.string().max(180).optional()
  })
  .optional();

const receiptAttachmentSchema = z
  .object({
    name: z.string().max(180).optional(),
    url: z.string().max(1000).optional(),
    uploadedAt: z.string().min(1).optional()
  })
  .optional();

const recurringSchema = z
  .object({
    active: z.boolean().optional(),
    recurrenceRule: z.string().max(240).optional(),
    nextDueDate: z.string().min(1).optional()
  })
  .optional();

const listBusinessIncomeSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      status: financialStatusEnum.optional(),
      incomeCategory: incomeCategoryEnum.optional(),
      businessUnit: businessUnitEnum.optional(),
      fromDate: z.string().min(1).optional(),
      toDate: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional()
    })
    .optional()
});

const createBusinessIncomeSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({
    businessUnit: businessUnitEnum.optional(),
    incomeCategory: incomeCategoryEnum,
    sourceModule: sourceModuleEnum.optional(),
    sourceReference: z.string().max(180).optional(),
    sourceRecordId: z.string().max(180).optional(),
    sourceRecordModel: z.string().max(120).optional(),
    description: z.string().min(2).max(500),
    amount: moneyInput,
    currency: z.string().length(3),
    exchangeRate: optionalMoneyInput,
    baseCurrency: z.string().length(3).optional(),
    exchangeRateDate: z.string().min(1).optional(),
    transactionDate: z.string().min(1).optional(),
    paymentMethod: z.string().max(80).optional(),
    reference: z.string().max(180).optional(),
    customerOrCounterparty: counterpartySchema,
    notes: z.string().max(2000).optional(),
    status: financialStatusEnum.optional(),
    idempotencyKey: z.string().max(240).optional(),
    metadata: z.record(z.any()).optional()
  })
});

const updateBusinessIncomeSchema = z.object({
  params: z.object({
    id: mongoObjectId
  }),
  query: z.object({}).optional(),
  body: z.object({
    businessUnit: businessUnitEnum.optional(),
    incomeCategory: incomeCategoryEnum.optional(),
    sourceModule: sourceModuleEnum.optional(),
    sourceReference: z.string().max(180).optional(),
    sourceRecordId: z.string().max(180).optional(),
    sourceRecordModel: z.string().max(120).optional(),
    description: z.string().min(2).max(500).optional(),
    amount: optionalMoneyInput,
    currency: z.string().length(3).optional(),
    exchangeRate: optionalMoneyInput,
    baseCurrency: z.string().length(3).optional(),
    exchangeRateDate: z.string().min(1).optional(),
    transactionDate: z.string().min(1).optional(),
    paymentMethod: z.string().max(80).optional(),
    reference: z.string().max(180).optional(),
    customerOrCounterparty: counterpartySchema,
    notes: z.string().max(2000).optional(),
    status: financialStatusEnum.optional(),
    metadata: z.record(z.any()).optional()
  })
});

const listBusinessExpenseSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      status: financialStatusEnum.optional(),
      category: expenseCategoryEnum.optional(),
      businessUnit: businessUnitEnum.optional(),
      paymentStatus: expensePaymentStatusEnum.optional(),
      fromDate: z.string().min(1).optional(),
      toDate: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional()
    })
    .optional()
});

const createBusinessExpenseSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({
    accountingScope: accountingScopeEnum.optional(),
    businessUnit: businessUnitEnum.optional(),
    category: expenseCategoryEnum,
    sourceModule: sourceModuleEnum.optional(),
    sourceReference: z.string().max(180).optional(),
    sourceRecordId: z.string().max(180).optional(),
    sourceRecordModel: z.string().max(120).optional(),
    bookingReference: z.string().max(180).optional(),
    bookingId: mongoObjectId.optional(),
    description: z.string().min(2).max(500),
    supplier: supplierSchema,
    amount: moneyInput,
    currency: z.string().length(3),
    exchangeRate: optionalMoneyInput,
    baseCurrency: z.string().length(3).optional(),
    exchangeRateDate: z.string().min(1).optional(),
    expenseDate: z.string().min(1).optional(),
    dueDate: z.string().min(1).optional(),
    paymentStatus: expensePaymentStatusEnum.optional(),
    paymentMethod: z.string().max(80).optional(),
    paymentReference: z.string().max(180).optional(),
    receiptAttachment: receiptAttachmentSchema,
    recurring: recurringSchema,
    notes: z.string().max(2000).optional(),
    status: financialStatusEnum.optional(),
    idempotencyKey: z.string().max(240).optional(),
    metadata: z.record(z.any()).optional()
  })
});

const updateBusinessExpenseSchema = z.object({
  params: z.object({
    id: mongoObjectId
  }),
  query: z.object({}).optional(),
  body: z.object({
    accountingScope: accountingScopeEnum.optional(),
    businessUnit: businessUnitEnum.optional(),
    category: expenseCategoryEnum.optional(),
    sourceModule: sourceModuleEnum.optional(),
    sourceReference: z.string().max(180).optional(),
    sourceRecordId: z.string().max(180).optional(),
    sourceRecordModel: z.string().max(120).optional(),
    bookingReference: z.string().max(180).optional(),
    bookingId: mongoObjectId.optional(),
    description: z.string().min(2).max(500).optional(),
    supplier: supplierSchema,
    amount: optionalMoneyInput,
    currency: z.string().length(3).optional(),
    exchangeRate: optionalMoneyInput,
    baseCurrency: z.string().length(3).optional(),
    exchangeRateDate: z.string().min(1).optional(),
    expenseDate: z.string().min(1).optional(),
    dueDate: z.string().min(1).optional(),
    paymentStatus: expensePaymentStatusEnum.optional(),
    paymentMethod: z.string().max(80).optional(),
    paymentReference: z.string().max(180).optional(),
    receiptAttachment: receiptAttachmentSchema,
    recurring: recurringSchema,
    notes: z.string().max(2000).optional(),
    status: financialStatusEnum.optional(),
    metadata: z.record(z.any()).optional()
  })
});

module.exports = {
  createBusinessExpenseSchema,
  createBusinessIncomeSchema,
  foundationQuerySchema,
  listBusinessExpenseSchema,
  listBusinessIncomeSchema,
  postBookingContributionSchema,
  updateBusinessExpenseSchema,
  updateBusinessIncomeSchema
};
