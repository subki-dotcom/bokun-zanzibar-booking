const { z } = require("zod");
const {
  ACCOUNTING_PERIOD_STATUS,
  BUSINESS_UNIT,
  COST_CENTER_TYPE,
  DEPRECIATION_METHOD,
  FIXED_ASSET_STATUS,
  GL_ACCOUNT_NORMAL_BALANCE,
  GL_ACCOUNT_SUBTYPE,
  GL_ACCOUNT_TYPE,
  GL_POSTING_TYPE,
  JOURNAL_STATUS,
  SOURCE_MODULE
} = require("../accounting/constants");

const mongoObjectId = z.string().regex(/^[a-f\d]{24}$/i, "A valid record ID is required");
const accountCode = z.string().trim().regex(/^[1-7]\d{3}(?:-[A-Z0-9]{1,16})?$/i);
const moneyInput = z.union([z.string().min(1), z.number().finite()]);
const accountTypeEnum = z.enum(Object.values(GL_ACCOUNT_TYPE));
const accountSubtypeEnum = z.enum(Object.values(GL_ACCOUNT_SUBTYPE));
const accountNormalBalanceEnum = z.enum(Object.values(GL_ACCOUNT_NORMAL_BALANCE));
const businessUnitEnum = z.enum(Object.values(BUSINESS_UNIT));
const costCenterEnum = z.enum(Object.values(COST_CENTER_TYPE));
const journalStatusEnum = z.enum(Object.values(JOURNAL_STATUS));
const postingTypeEnum = z.enum(Object.values(GL_POSTING_TYPE));
const sourceModuleEnum = z.enum(Object.values(SOURCE_MODULE));
const periodStatusEnum = z.enum(Object.values(ACCOUNTING_PERIOD_STATUS));
const depreciationMethodEnum = z.enum(Object.values(DEPRECIATION_METHOD));
const fixedAssetStatusEnum = z.enum(Object.values(FIXED_ASSET_STATUS));
const queryBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return value;
}, z.boolean());

const listChartOfAccountsSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      type: accountTypeEnum.optional(),
      subtype: accountSubtypeEnum.optional(),
      active: queryBoolean.optional(),
      status: z.enum(["all", "active", "inactive"]).optional(),
      includeInactive: queryBoolean.optional(),
      search: z.string().max(120).optional(),
      systemAccount: z.enum(["all", "system", "manual"]).optional(),
      hasParent: queryBoolean.optional(),
      page: z.coerce.number().int().min(1).max(100000).optional(),
      limit: z.coerce.number().int().min(1).max(1000).optional(),
      sortBy: z.enum(["code", "name", "type", "subtype", "active", "createdAt", "updatedAt"]).optional(),
      sortDirection: z.enum(["asc", "desc"]).optional()
    })
    .optional()
});

const createChartAccountSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({
    code: accountCode,
    name: z.string().trim().min(2).max(180),
    type: accountTypeEnum,
    subtype: accountSubtypeEnum,
    normalBalance: accountNormalBalanceEnum.optional(),
    parentAccount: z.union([mongoObjectId, z.literal(""), z.null()]).optional(),
    parentCode: accountCode.optional(),
    currency: z.union([z.string().trim().length(3), z.literal("")]).optional(),
    businessUnit: businessUnitEnum.optional(),
    active: z.boolean().optional(),
    allowManualPosting: z.boolean().optional(),
    description: z.string().trim().max(1000).optional(),
    metadata: z.record(z.any()).optional()
  })
});

const updateChartAccountSchema = z.object({
  params: z.object({
    id: mongoObjectId
  }),
  query: z.object({}).optional(),
  body: z.object({
    name: z.string().trim().min(2).max(180).optional(),
    type: accountTypeEnum.optional(),
    subtype: accountSubtypeEnum.optional(),
    normalBalance: accountNormalBalanceEnum.optional(),
    parentAccount: z.union([mongoObjectId, z.literal(""), z.null()]).optional(),
    parentCode: accountCode.optional(),
    currency: z.union([z.string().trim().length(3), z.literal("")]).optional(),
    businessUnit: businessUnitEnum.optional(),
    active: z.boolean().optional(),
    allowManualPosting: z.boolean().optional(),
    description: z.string().trim().max(1000).optional(),
    metadata: z.record(z.any()).optional()
  })
});

const seedChartOfAccountsSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z
    .object({
      dryRun: z.boolean().optional(),
      reason: z.string().trim().max(1000).optional()
    })
    .default({})
});

const journalLineSchema = z.object({
  accountCode: accountCode.optional(),
  mappingKey: z.string().trim().max(120).optional(),
  description: z.string().trim().max(500).optional(),
  debit: moneyInput.optional(),
  credit: moneyInput.optional(),
  currency: z.string().trim().length(3).optional(),
  exchangeRate: moneyInput.optional(),
  businessUnit: businessUnitEnum.optional(),
  costCenter: costCenterEnum.optional(),
  productId: z.string().trim().max(120).optional(),
  channel: z.string().trim().max(120).optional(),
  customerId: z.string().trim().max(120).optional(),
  supplierId: z.string().trim().max(120).optional(),
  agentId: z.string().trim().max(120).optional(),
  bookingId: z.string().trim().max(120).optional(),
  bookingReference: z.string().trim().max(180).optional(),
  vehicleId: z.string().trim().max(120).optional(),
  driverId: z.string().trim().max(120).optional(),
  guideId: z.string().trim().max(120).optional(),
  metadata: z.record(z.any()).optional()
});

const createJournalSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({
    entryDate: z.string().min(1).optional(),
    postingDate: z.string().min(1).optional(),
    sourceModule: sourceModuleEnum.optional(),
    sourceEntityType: z.string().trim().max(120).optional(),
    sourceEntityId: z.string().trim().max(180).optional(),
    sourceReference: z.string().trim().max(180).optional(),
    postingType: postingTypeEnum.optional(),
    postingKey: z.string().trim().max(260).optional(),
    description: z.string().trim().min(2).max(500),
    currency: z.string().trim().length(3),
    baseCurrency: z.string().trim().length(3).optional(),
    exchangeRate: moneyInput.optional(),
    reason: z.string().trim().min(2).max(1000).optional(),
    evidence: z.record(z.any()).optional(),
    requiresApproval: z.boolean().optional(),
    submit: z.boolean().optional(),
    lines: z.array(journalLineSchema).min(2)
  })
});

const listJournalsSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      status: journalStatusEnum.optional(),
      sourceModule: sourceModuleEnum.optional(),
      fromDate: z.string().min(1).optional(),
      toDate: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(1000).optional()
    })
    .optional()
});

const journalActionSchema = z.object({
  params: z.object({
    id: mongoObjectId
  }),
  query: z.object({}).optional(),
  body: z
    .object({
      reason: z.string().trim().max(1000).optional(),
      override: z.boolean().optional()
    })
    .default({})
});

const ledgerReportQuerySchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      accountCode: accountCode.optional(),
      accountId: mongoObjectId.optional(),
      fromDate: z.string().min(1).optional(),
      toDate: z.string().min(1).optional(),
      asOfDate: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(5000).optional()
    })
    .optional()
});

const listPeriodsSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      year: z.coerce.number().int().min(2000).max(2100).optional(),
      status: periodStatusEnum.optional()
    })
    .optional()
});

const createPeriodSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12)
  })
});

const periodActionSchema = z.object({
  params: z.object({
    id: mongoObjectId
  }),
  query: z.object({}).optional(),
  body: z.object({
    reason: z.string().trim().min(2).max(1000)
  })
});

const seedMappingsSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z
    .object({
      dryRun: z.boolean().optional()
    })
    .default({})
});

const historicalMigrationSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z
    .object({
      dryRun: z.boolean().optional(),
      fromDate: z.string().min(1).optional(),
      toDate: z.string().min(1).optional(),
      evidenceNote: z.string().trim().max(2000).optional()
    })
    .default({})
});

const createFixedAssetSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({
    assetReference: z.string().trim().max(120).optional(),
    name: z.string().trim().min(2).max(180),
    assetAccount: mongoObjectId,
    accumulatedDepreciationAccount: mongoObjectId,
    depreciationExpenseAccount: mongoObjectId,
    purchaseCost: moneyInput,
    currency: z.string().trim().length(3),
    salvageValue: moneyInput.optional(),
    usefulLifeMonths: z.coerce.number().int().min(1).max(600),
    depreciationMethod: depreciationMethodEnum.optional(),
    startDate: z.string().min(1),
    status: fixedAssetStatusEnum.optional(),
    metadata: z.record(z.any()).optional()
  })
});

const exportLedgerReportSchema = z.object({
  params: z.object({
    reportType: z.enum(["general-ledger", "trial-balance", "profit-loss", "balance-sheet", "journal-register"])
  }),
  body: z.object({}).optional(),
  query: z
    .object({
      format: z.enum(["csv", "xlsx", "excel", "pdf", "json"]).optional(),
      accountCode: accountCode.optional(),
      fromDate: z.string().min(1).optional(),
      toDate: z.string().min(1).optional(),
      asOfDate: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(5000).optional()
    })
    .optional()
});

module.exports = {
  createFixedAssetSchema,
  createChartAccountSchema,
  createJournalSchema,
  createPeriodSchema,
  exportLedgerReportSchema,
  historicalMigrationSchema,
  journalActionSchema,
  ledgerReportQuerySchema,
  listChartOfAccountsSchema,
  listJournalsSchema,
  listPeriodsSchema,
  periodActionSchema,
  seedChartOfAccountsSchema,
  seedMappingsSchema,
  updateChartAccountSchema
};
