const AuditLog = require("../../models/AuditLog");
const ChartOfAccount = require("../../models/ChartOfAccount");
const { DEFAULT_CHART_OF_ACCOUNTS } = require("../../accounting/defaultChartOfAccounts");
const {
  BUSINESS_UNIT,
  GL_ACCOUNT_NORMAL_BALANCE,
  GL_ACCOUNT_TYPE
} = require("../../accounting/constants");
const AppError = require("../../utils/AppError");

const CODE_PATTERN = /^[1-7]\d{3}(?:-[A-Z0-9]{1,16})?$/;

const normalizeToken = (value = "") => String(value || "").trim();
const normalizeEnumToken = (value = "") => normalizeToken(value).toUpperCase();
const asArray = (value) => (Array.isArray(value) ? value : []);

const leanMaybe = async (value) => {
  if (value && typeof value.lean === "function") return value.lean();
  return value;
};

const sortByCode = (rows = []) =>
  [...rows].sort((left, right) => String(left.code || "").localeCompare(String(right.code || ""), "en"));

const normalBalanceForType = (type = "") =>
  [
    GL_ACCOUNT_TYPE.ASSET,
    GL_ACCOUNT_TYPE.COST_OF_SALES,
    GL_ACCOUNT_TYPE.EXPENSE,
    GL_ACCOUNT_TYPE.OTHER_EXPENSE
  ].includes(type)
    ? GL_ACCOUNT_NORMAL_BALANCE.DEBIT
    : GL_ACCOUNT_NORMAL_BALANCE.CREDIT;

const accountTypeForCode = (code = "") => {
  const prefix = normalizeEnumToken(code).charAt(0);
  if (prefix === "1") return GL_ACCOUNT_TYPE.ASSET;
  if (prefix === "2") return GL_ACCOUNT_TYPE.LIABILITY;
  if (prefix === "3") return GL_ACCOUNT_TYPE.EQUITY;
  if (prefix === "4") return GL_ACCOUNT_TYPE.REVENUE;
  if (prefix === "5") return GL_ACCOUNT_TYPE.COST_OF_SALES;
  if (prefix === "6") return GL_ACCOUNT_TYPE.EXPENSE;
  if (prefix === "7") return "OTHER";
  return "";
};

const assertCodeMatchesType = ({ code = "", type = "" } = {}) => {
  const normalizedCode = normalizeEnumToken(code);
  const normalizedType = normalizeEnumToken(type);
  if (!CODE_PATTERN.test(normalizedCode)) {
    throw new AppError(
      "Chart of account code is invalid.",
      422,
      "GL_ACCOUNT_CODE_INVALID",
      { code: normalizedCode }
    );
  }

  const expectedType = accountTypeForCode(normalizedCode);
  if (expectedType === "OTHER") {
    if (![GL_ACCOUNT_TYPE.OTHER_INCOME, GL_ACCOUNT_TYPE.OTHER_EXPENSE].includes(normalizedType)) {
      throw new AppError(
        "7xxx chart account codes are reserved for other income and other expense accounts.",
        422,
        "GL_ACCOUNT_CODE_TYPE_MISMATCH",
        { code: normalizedCode, type: normalizedType }
      );
    }
    return;
  }

  if (expectedType && expectedType !== normalizedType) {
    throw new AppError(
      "Chart account type does not match the configured code range.",
      422,
      "GL_ACCOUNT_CODE_TYPE_MISMATCH",
      { code: normalizedCode, expectedType, type: normalizedType }
    );
  }
};

const normalizeId = (value) => {
  if (!value) return null;
  if (value.toString) return value.toString();
  return String(value);
};

const normalizeChartAccountForApi = (account = {}) => {
  const row = account?.toObject ? account.toObject() : account || {};
  return {
    id: normalizeId(row._id),
    code: row.code || "",
    name: row.name || "",
    type: row.type || "",
    subtype: row.subtype || "",
    normalBalance: row.normalBalance || normalBalanceForType(row.type),
    parentAccount: normalizeId(row.parentAccount),
    parentCode: row.parentCode || "",
    currency: row.currency || "",
    businessUnit: row.businessUnit || BUSINESS_UNIT.UNALLOCATED,
    active: row.active !== false,
    systemAccount: Boolean(row.systemAccount),
    allowManualPosting: row.allowManualPosting !== false,
    description: row.description || "",
    metadata: row.metadata || {},
    createdBy: row.createdBy || "",
    updatedBy: row.updatedBy || "",
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
};

const isPresent = (value) => value !== undefined && value !== null;

const buildChartAccountValues = ({ input = {}, existing = null, auth = {}, systemAccount = null } = {}) => {
  const code = normalizeEnumToken(input.code ?? existing?.code);
  const type = normalizeEnumToken(input.type ?? existing?.type);
  const subtype = normalizeEnumToken(input.subtype ?? existing?.subtype);
  const normalBalance = normalizeEnumToken(input.normalBalance ?? existing?.normalBalance ?? normalBalanceForType(type));
  const name = normalizeToken(input.name ?? existing?.name);

  assertCodeMatchesType({ code, type });

  if (!name) {
    throw new AppError("Chart account name is required.", 422, "GL_ACCOUNT_NAME_REQUIRED");
  }

  if (!Object.values(GL_ACCOUNT_NORMAL_BALANCE).includes(normalBalance)) {
    throw new AppError("Chart account normal balance is invalid.", 422, "GL_ACCOUNT_NORMAL_BALANCE_INVALID");
  }

  const parentAccount =
    input.parentAccount === "" || input.parentAccount === null
      ? null
      : input.parentAccount ?? existing?.parentAccount ?? null;
  const parentCode = normalizeEnumToken(input.parentCode ?? existing?.parentCode ?? "");
  const currency = normalizeEnumToken(input.currency ?? existing?.currency ?? "");
  const businessUnit = normalizeEnumToken(input.businessUnit ?? existing?.businessUnit ?? BUSINESS_UNIT.UNALLOCATED);

  if (!Object.values(BUSINESS_UNIT).includes(businessUnit)) {
    throw new AppError("Chart account business unit is invalid.", 422, "GL_ACCOUNT_BUSINESS_UNIT_INVALID");
  }

  return {
    code,
    name,
    type,
    subtype,
    normalBalance,
    parentAccount,
    parentCode,
    currency,
    businessUnit,
    active: isPresent(input.active) ? Boolean(input.active) : existing?.active !== false,
    systemAccount: isPresent(systemAccount) ? Boolean(systemAccount) : Boolean(existing?.systemAccount),
    allowManualPosting: isPresent(input.allowManualPosting)
      ? Boolean(input.allowManualPosting)
      : existing?.allowManualPosting !== false,
    description: normalizeToken(input.description ?? existing?.description ?? ""),
    metadata: input.metadata ?? existing?.metadata ?? {},
    updatedBy: auth?.id || existing?.updatedBy || ""
  };
};

const createChartOfAccountsService = ({
  AuditLogModel = AuditLog,
  ChartOfAccountModel = ChartOfAccount,
  defaultAccounts = DEFAULT_CHART_OF_ACCOUNTS,
  now = () => new Date()
} = {}) => {
  const recordAudit = async ({
    action,
    account = null,
    auth = {},
    requestId = "",
    reason = "",
    before = null,
    after = null,
    metadata = {}
  }) => {
    if (!AuditLogModel?.create) return null;
    return AuditLogModel.create({
      actorId: auth?.id || null,
      actorRole: auth?.role || "system",
      action,
      entityType: "ChartOfAccount",
      entityId: normalizeId(account?._id) || metadata.entityId || "chart-of-accounts",
      reference: account?.code || metadata.reference || "",
      reason,
      requestId,
      before,
      after,
      metadata
    });
  };

  const findOne = async (query = {}) => leanMaybe(ChartOfAccountModel.findOne(query));

  const findMany = async (query = {}, { limit = 500 } = {}) => {
    let result = ChartOfAccountModel.find(query);
    if (result && typeof result.sort === "function") {
      result = result.sort({ code: 1 });
    }
    if (result && typeof result.limit === "function") {
      result = result.limit(limit);
    }
    const rows = await leanMaybe(result);
    return sortByCode(asArray(rows)).slice(0, limit);
  };

  const listAccounts = async ({
    type = "",
    subtype = "",
    active = null,
    includeInactive = false,
    search = "",
    limit = 500
  } = {}) => {
    const query = {};
    if (type) query.type = normalizeEnumToken(type);
    if (subtype) query.subtype = normalizeEnumToken(subtype);
    if (!includeInactive) query.active = active === null || active === undefined ? true : Boolean(active);
    if (includeInactive && active !== null && active !== undefined) query.active = Boolean(active);
    if (search) {
      const expression = new RegExp(normalizeToken(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ code: expression }, { name: expression }, { description: expression }];
    }

    const items = await findMany(query, { limit });
    return {
      items: items.map(normalizeChartAccountForApi),
      count: items.length,
      filters: {
        type: query.type || "",
        subtype: query.subtype || "",
        active: query.active,
        includeInactive: Boolean(includeInactive),
        search: normalizeToken(search),
        limit
      }
    };
  };

  const createAccount = async ({ input = {}, auth = {}, requestId = "" } = {}) => {
    const values = {
      ...buildChartAccountValues({ input, auth, systemAccount: false }),
      createdBy: auth?.id || ""
    };

    const duplicate = await findOne({ code: values.code });
    if (duplicate) {
      throw new AppError("Chart account code already exists.", 409, "GL_ACCOUNT_CODE_EXISTS", {
        code: values.code
      });
    }

    const created = await ChartOfAccountModel.create(values);
    const account = normalizeChartAccountForApi(created);
    await recordAudit({
      action: "gl_chart_account_created",
      account: created,
      auth,
      requestId,
      reason: "Chart of account created",
      after: account
    });

    return {
      action: "created",
      account
    };
  };

  const updateAccount = async ({ accountId, input = {}, auth = {}, requestId = "" } = {}) => {
    const existing = await leanMaybe(ChartOfAccountModel.findById(accountId));
    if (!existing) {
      throw new AppError("Chart account not found.", 404, "GL_ACCOUNT_NOT_FOUND");
    }

    if (input.code && normalizeEnumToken(input.code) !== existing.code) {
      throw new AppError("Chart account code cannot be changed after creation.", 409, "GL_ACCOUNT_CODE_IMMUTABLE");
    }

    if (existing.systemAccount) {
      const protectedFields = ["type", "subtype", "normalBalance", "parentAccount", "parentCode", "currency"];
      const changedProtectedField = protectedFields.some((field) => input[field] !== undefined);
      if (changedProtectedField) {
        throw new AppError(
          "System chart accounts cannot have structural fields changed.",
          409,
          "GL_SYSTEM_ACCOUNT_PROTECTED"
        );
      }
      if (input.active === false) {
        throw new AppError("System chart accounts cannot be deactivated.", 409, "GL_SYSTEM_ACCOUNT_PROTECTED");
      }
    }

    const before = normalizeChartAccountForApi(existing);
    const values = buildChartAccountValues({
      input: {
        ...input,
        code: existing.code,
        type: input.type ?? existing.type,
        subtype: input.subtype ?? existing.subtype
      },
      existing,
      auth,
      systemAccount: existing.systemAccount
    });

    const updated = await leanMaybe(
      ChartOfAccountModel.findByIdAndUpdate(accountId, { $set: values }, { new: true })
    );
    const account = normalizeChartAccountForApi(updated);

    await recordAudit({
      action: "gl_chart_account_updated",
      account: updated || existing,
      auth,
      requestId,
      reason: "Chart of account updated",
      before,
      after: account
    });

    return {
      action: "updated",
      account
    };
  };

  const seedDefaultChart = async ({ dryRun = true, auth = {}, requestId = "", reason = "" } = {}) => {
    const existingAccounts = await findMany({}, { limit: 5000 });
    const byCode = new Map(existingAccounts.map((account) => [account.code, account]));
    const plan = [];
    const warnings = [];

    for (const definition of defaultAccounts) {
      const existing = byCode.get(definition.code);
      const values = buildChartAccountValues({
        input: definition,
        auth,
        systemAccount: true
      });

      if (existing) {
        const mismatches = ["name", "type", "subtype", "normalBalance"].filter(
          (field) => normalizeEnumToken(existing[field]) !== normalizeEnumToken(values[field])
        );
        if (mismatches.length) {
          warnings.push({
            code: definition.code,
            warning: "Existing account differs from the default chart definition and was not overwritten.",
            mismatches
          });
        }
        plan.push({
          action: "exists",
          code: definition.code,
          account: normalizeChartAccountForApi(existing)
        });
        continue;
      }

      plan.push({
        action: "create",
        code: definition.code,
        parentCode: definition.parentCode || "",
        account: normalizeChartAccountForApi(values)
      });
    }

    if (dryRun) {
      return {
        dryRun: true,
        action: "planned",
        willCreate: plan.filter((item) => item.action === "create").length,
        alreadyExists: plan.filter((item) => item.action === "exists").length,
        warnings,
        plan
      };
    }

    const created = [];
    for (const item of plan.filter((row) => row.action === "create")) {
      const definition = defaultAccounts.find((row) => row.code === item.code);
      const parent = definition.parentCode ? byCode.get(definition.parentCode) : null;
      const values = {
        ...buildChartAccountValues({
          input: {
            ...definition,
            parentAccount: parent?._id || null
          },
          auth,
          systemAccount: true
        }),
        createdBy: auth?.id || ""
      };
      const row = await ChartOfAccountModel.create(values);
      byCode.set(values.code, row?.toObject ? row.toObject() : row);
      created.push(normalizeChartAccountForApi(row));
    }

    await recordAudit({
      action: "gl_chart_accounts_seeded",
      auth,
      requestId,
      reason: reason || "Default chart of accounts seeded",
      after: {
        createdCount: created.length,
        existingCount: plan.filter((item) => item.action === "exists").length,
        seededAt: now().toISOString()
      },
      metadata: {
        entityId: "default-chart-of-accounts",
        reference: "DEFAULT_COA",
        dryRun: false,
        warnings
      }
    });

    return {
      dryRun: false,
      action: created.length ? "created" : "unchanged",
      createdCount: created.length,
      alreadyExists: plan.filter((item) => item.action === "exists").length,
      warnings,
      created,
      plan
    };
  };

  return {
    createAccount,
    listAccounts,
    seedDefaultChart,
    updateAccount
  };
};

const service = createChartOfAccountsService();

module.exports = {
  ...service,
  createChartOfAccountsService,
  __testables: {
    accountTypeForCode,
    assertCodeMatchesType,
    buildChartAccountValues,
    normalBalanceForType,
    normalizeChartAccountForApi
  }
};
