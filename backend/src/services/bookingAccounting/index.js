const Booking = require("../../models/Booking");
const BusinessExpense = require("../../models/BusinessExpense");
const Invoice = require("../../models/Invoice");
const Payment = require("../../models/Payment");
const ProductCostTemplate = require("../../models/ProductCostTemplate");
const ProductSnapshot = require("../../models/ProductSnapshot");
const Refund = require("../../models/Refund");
const { EXPENSE_CATEGORY } = require("../../accounting/constants");
const AuditLog = require("../../models/AuditLog");
const logger = require("../../config/logger");
const toursService = require("../tours");
const AppError = require("../../utils/AppError");

const DEFAULT_LIMIT = 50;
const DEFAULT_TEMPLATE_LIMIT = 10;
const MAX_LIMIT = 500;

const COST_BASIS_TYPES = Object.freeze([
  "fixed_per_booking",
  "per_participant",
  "per_adult",
  "per_child",
  "per_vehicle",
  "per_group",
  "percentage",
  "tiered",
  "manual"
]);

const TEMPLATE_STATUSES = Object.freeze(["draft", "active", "inactive", "archived"]);
const OPEN_ENDED_DATE = new Date("9999-12-31T23:59:59.999Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const CHANNEL_LABELS = Object.freeze({
  DIRECT_WEBSITE: "Direct Website",
  WEBSITE: "Direct Website",
  GETYOURGUIDE: "GetYourGuide",
  GET_YOUR_GUIDE: "GetYourGuide",
  GYG: "GetYourGuide",
  VIATOR: "Viator",
  BOKUN: "Bokun Direct",
  BOKUN_DIRECT: "Bokun Direct",
  BOKUN_MARKETPLACE: "Bokun Marketplace",
  MARKETPLACE: "Bokun Marketplace",
  AGENT: "Agent / B2B",
  B2B: "Agent / B2B",
  HOTEL: "Hotel",
  WHATSAPP: "WhatsApp",
  WALK_IN: "Walk-in",
  TOURHQ: "TourHQ",
  AIRBNB: "Airbnb",
  OTHER: "Other"
});

const asArray = (value) => (Array.isArray(value) ? value : []);

const normalizeToken = (value = "") => String(value || "").trim();
const normalizeLower = (value = "") => normalizeToken(value).toLowerCase();
const normalizeUpper = (value = "") => normalizeToken(value).toUpperCase();

const getId = (record = {}) => normalizeToken(record?._id || record?.id);

const escapeRegex = (value = "") => normalizeToken(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "$numberDecimal")) {
    const parsed = Number(value.$numberDecimal);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (typeof value === "object" && value._bsontype === "Decimal128" && typeof value.toString === "function") {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundMoney = (value) => Number(toNumber(value, 0).toFixed(2));

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toIso = (value) => {
  const date = toDate(value);
  return date ? date.toISOString() : "";
};

const pagination = ({ page = 1, limit = DEFAULT_LIMIT } = {}) => {
  const safePage = Math.max(1, Number(page || 1));
  const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Number(limit || DEFAULT_LIMIT)));
  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit
  };
};

const addDateRange = (query, field, { fromDate = "", toDate: endDate = "" } = {}) => {
  const range = {};
  const from = toDate(fromDate);
  const to = toDate(endDate);
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  if (Object.keys(range).length) query[field] = range;
  return query;
};

const addRegexSearch = (query, fields = [], search = "") => {
  const pattern = escapeRegex(search);
  if (!pattern) return query;
  const searchClause = {
    $or: fields.map((field) => ({ [field]: new RegExp(pattern, "i") }))
  };
  if (query.$or) {
    const existingOr = query.$or;
    delete query.$or;
    query.$and = [...(query.$and || []), { $or: existingOr }, searchClause];
    return query;
  }
  query.$or = searchClause.$or;
  return query;
};

const applyQueryChain = async (query, { sort = { updatedAt: -1 }, skip = 0, limit = DEFAULT_LIMIT } = {}) => {
  if (Array.isArray(query)) return query.slice(skip, skip + limit);
  let chain = query;
  if (chain?.sort) chain = chain.sort(sort);
  if (chain?.skip) chain = chain.skip(skip);
  if (chain?.limit) chain = chain.limit(limit);
  if (chain?.lean) chain = chain.lean();
  const rows = await chain;
  return asArray(rows);
};

const findRows = async (Model, query = {}, options = {}) => {
  if (!Model?.find) return [];
  const found = Model.find(query);
  return applyQueryChain(found, options);
};

const countRows = async (Model, query = {}) => {
  if (Model?.countDocuments) return Number(await Model.countDocuments(query));
  return (await findRows(Model, query, { limit: MAX_LIMIT })).length;
};

const executeSingleQuery = async (query, options = {}) => {
  if (Array.isArray(query)) return query[0] || null;
  let chain = query;
  if (options.sort && chain?.sort) chain = chain.sort(options.sort);
  if (chain?.lean) chain = chain.lean();
  return chain ? await chain : null;
};

const findOneRow = async (Model, query = {}, options = {}) => {
  if (Model?.findOne) return executeSingleQuery(Model.findOne(query), options);
  return (await findRows(Model, query, { ...options, limit: 1 }))[0] || null;
};

const findByIdRow = async (Model, id) => {
  const safeId = normalizeToken(id);
  if (!safeId) return null;
  if (Model?.findById) return executeSingleQuery(Model.findById(safeId));
  return findOneRow(Model, { _id: safeId });
};

const createRow = async (Model, payload) => {
  if (!Model?.create) throw new AppError("Product cost template storage is not configured.", 503, "COST_TEMPLATE_STORAGE_UNAVAILABLE");
  const created = await Model.create(payload);
  return created?.toObject ? created.toObject() : created;
};

const updateByIdRow = async (Model, id, update = {}) => {
  const safeId = normalizeToken(id);
  if (!safeId) return null;
  if (Model?.findByIdAndUpdate) {
    return executeSingleQuery(
      Model.findByIdAndUpdate(safeId, { $set: update }, { new: true, runValidators: true })
    );
  }
  if (Model?.findOneAndUpdate) {
    return executeSingleQuery(
      Model.findOneAndUpdate({ _id: safeId }, { $set: update }, { new: true, runValidators: true })
    );
  }
  throw new AppError("Product cost template storage cannot update records.", 503, "COST_TEMPLATE_STORAGE_UNAVAILABLE");
};

const normalizeCostBasis = (value = "") => normalizeLower(value).replace(/[-\s]+/g, "_");
const normalizeTemplateStatus = (value = "draft") => normalizeLower(value || "draft").replace(/[-\s]+/g, "_");
const normalizeCurrency = (value = "USD") => normalizeUpper(value || "USD").slice(0, 10);
const sameToken = (left, right) => normalizeToken(left) === normalizeToken(right);

const titleize = (value = "") =>
  normalizeToken(value || "Unknown")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const normalizeChannel = (value = "") =>
  normalizeUpper(value || "OTHER")
    .replace(/[-\s/]+/g, "_")
    .replace(/_+/g, "_");

const channelLabel = (value = "") => {
  const normalized = normalizeChannel(value);
  return CHANNEL_LABELS[normalized] || titleize(normalized || "OTHER");
};

const startOfDay = (value) => {
  const date = toDate(value);
  if (!date) return null;
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const endOfDay = (value) => {
  const date = toDate(value);
  if (!date) return null;
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
};

const addDays = (value, days = 0) => {
  const date = toDate(value);
  if (!date) return null;
  const copy = new Date(date);
  copy.setDate(copy.getDate() + Number(days || 0));
  return copy;
};

const resolveDashboardRange = (filters = {}) => {
  const from = startOfDay(filters.fromDate);
  const to = endOfDay(filters.toDate);
  if (!from && !to) {
    return {
      current: null,
      previous: null,
      label: "All time"
    };
  }

  const now = new Date();
  const currentFrom = from || new Date("1970-01-01T00:00:00.000Z");
  const currentTo = to || now;
  const days = Math.max(1, Math.ceil((currentTo.getTime() - currentFrom.getTime() + 1) / DAY_MS));
  const previousTo = endOfDay(addDays(currentFrom, -1));
  const previousFrom = startOfDay(addDays(previousTo, 1 - days));

  return {
    current: { from: currentFrom, to: currentTo },
    previous: previousFrom && previousTo ? { from: previousFrom, to: previousTo } : null,
    label: filters.dateRange || filters.range || "Custom"
  };
};

const dateInRange = (value, range = null) => {
  if (!range) return true;
  const date = toDate(value);
  if (!date) return false;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
};

const toCents = (value) => Math.round(roundMoney(value) * 100);
const fromCents = (value) => roundMoney(Number(value || 0) / 100);

const templateIdentityKey = ({ bokunProductId = "", bokunOptionId = "", pricingCategoryId = "" } = {}) =>
  [bokunProductId, bokunOptionId, pricingCategoryId].map(normalizeToken).join("::");

const mergeUniqueById = (items = [], idField = "id") => {
  const map = new Map();
  asArray(items).forEach((item) => {
    const id = normalizeToken(item?.[idField] || item?.id || item?.pricingCategoryId || item?.categoryId);
    if (!id || map.has(id)) return;
    map.set(id, item);
  });
  return Array.from(map.values());
};

const extractPricingCategories = (product = {}, option = {}) => {
  const raw = product.rawBokunProduct || {};
  const candidates = [
    ...asArray(product.pricingCategories),
    ...asArray(product.priceCategories),
    ...asArray(option.pricingCategories),
    ...asArray(option.priceCategories),
    ...asArray(raw.pricingCategories),
    ...asArray(raw.priceCategories),
    ...asArray(raw.ticketCategories),
    ...asArray(raw?.activity?.pricingCategories)
  ];

  return mergeUniqueById(
    candidates
      .map((category) => {
        const pricingCategoryId = normalizeToken(category?.pricingCategoryId || category?.categoryId || category?.id);
        if (!pricingCategoryId) return null;
        return {
          pricingCategoryId,
          title: normalizeToken(category?.title || category?.name || category?.label || pricingCategoryId),
          ticketCategory: normalizeToken(category?.ticketCategory || category?.type || "")
        };
      })
      .filter(Boolean),
    "pricingCategoryId"
  );
};

const firstImage = (record = {}) => normalizeToken(asArray(record.images)[0] || record.image || record.thumbnail || "");

const buildBokunCostInventory = ({ productSnapshots = [], bookings = [] } = {}) => {
  const productsById = new Map();
  const optionsByKey = new Map();

  const ensureProduct = (product = {}) => {
    const bokunProductId = normalizeToken(product.bokunProductId);
    if (!bokunProductId) return null;
    const current = productsById.get(bokunProductId) || {
      bokunProductId,
      title: normalizeToken(product.title || product.productTitle || bokunProductId),
      productSnapshotId: getId(product),
      currency: normalizeCurrency(product.currency || product.pricingSnapshot?.currency || "USD"),
      image: firstImage(product),
      status: normalizeToken(product.status || "active"),
      lastSyncedAt: toIso(product.lastSyncedAt || product.updatedAt),
      optionCount: 0,
      pricingCategories: []
    };
    current.title = normalizeToken(current.title || product.title || product.productTitle || bokunProductId);
    current.currency = normalizeCurrency(current.currency || product.currency || product.pricingSnapshot?.currency || "USD");
    current.image = current.image || firstImage(product);
    current.lastSyncedAt = current.lastSyncedAt || toIso(product.lastSyncedAt || product.updatedAt);
    current.pricingCategories = mergeUniqueById(
      [...asArray(current.pricingCategories), ...extractPricingCategories(product)],
      "pricingCategoryId"
    );
    productsById.set(bokunProductId, current);
    return current;
  };

  const addOption = ({ product = {}, option = {}, source = "ProductSnapshot" }) => {
    const parent = ensureProduct(product);
    const bokunProductId = parent?.bokunProductId || normalizeToken(product.bokunProductId);
    const bokunOptionId = normalizeToken(option.bokunOptionId || option.optionId || option.id);
    if (!bokunProductId || !bokunOptionId) return;
    const key = templateIdentityKey({ bokunProductId, bokunOptionId });
    const existing = optionsByKey.get(key) || {
      id: key,
      bokunProductId,
      bokunProductTitle: parent?.title || normalizeToken(product.title || product.productTitle || bokunProductId),
      bokunProductImage: parent?.image || firstImage(product),
      productSnapshotId: parent?.productSnapshotId || getId(product),
      bokunOptionId,
      bokunOptionTitle: normalizeToken(option.name || option.title || option.optionTitle || bokunOptionId),
      currency: normalizeCurrency(option.currency || product.currency || product.pricingSnapshot?.currency || "USD"),
      optionActive: option.active !== false,
      productStatus: parent?.status || normalizeToken(product.status || "active"),
      pricingCategories: [],
      source,
      sourceProductLastSyncedAt: parent?.lastSyncedAt || toIso(product.lastSyncedAt || product.updatedAt)
    };

    existing.bokunProductTitle = existing.bokunProductTitle || normalizeToken(product.title || product.productTitle || bokunProductId);
    existing.bokunOptionTitle = existing.bokunOptionTitle || normalizeToken(option.name || option.title || option.optionTitle || bokunOptionId);
    existing.bokunProductImage = existing.bokunProductImage || firstImage(product);
    existing.pricingCategories = mergeUniqueById(
      [
        ...asArray(existing.pricingCategories),
        ...asArray(parent?.pricingCategories),
        ...extractPricingCategories(product, option),
        ...asArray(product.priceCategoryParticipants).map((category) => ({
          pricingCategoryId: normalizeToken(category.categoryId || category.pricingCategoryId),
          title: normalizeToken(category.title || category.label || category.categoryId),
          ticketCategory: normalizeToken(category.ticketCategory)
        }))
      ].filter((category) => normalizeToken(category?.pricingCategoryId)),
      "pricingCategoryId"
    );
    optionsByKey.set(key, existing);
    if (parent) parent.optionCount = new Set([...asArray(parent.optionIds), bokunOptionId]).size;
    if (parent) parent.optionIds = [...new Set([...asArray(parent.optionIds), bokunOptionId])];
  };

  asArray(productSnapshots).forEach((product) => {
    ensureProduct(product);
    asArray(product.options)
      .filter((option) => option?.active !== false)
      .forEach((option) => addOption({ product, option, source: "ProductSnapshot" }));
  });

  asArray(bookings).forEach((booking) => {
    addOption({
      product: {
        bokunProductId: booking.bokunProductId,
        title: booking.productTitle,
        currency: booking.currency || booking.pricingSnapshot?.currency,
        status: booking.bookingStatus,
        priceCategoryParticipants: booking.priceCategoryParticipants,
        updatedAt: booking.updatedAt
      },
      option: {
        bokunOptionId: booking.bokunOptionId,
        name: booking.optionTitle,
        active: true
      },
      source: "Booking"
    });
  });

  const products = Array.from(productsById.values())
    .map((product) => ({
      ...product,
      optionCount: asArray(product.optionIds).length,
      optionIds: undefined
    }))
    .sort((left, right) => left.title.localeCompare(right.title));

  const options = Array.from(optionsByKey.values()).sort(
    (left, right) =>
      left.bokunProductTitle.localeCompare(right.bokunProductTitle) ||
      left.bokunOptionTitle.localeCompare(right.bokunOptionTitle)
  );

  return { products, options };
};

const lineAmountCents = (line = {}, context = {}) => {
  const basis = normalizeCostBasis(line.basis);
  const amountCents = toCents(line.amount);
  const participants = Math.max(0, Number(context.participants || 0));
  const adults = Math.max(0, Number(context.adults || 0));
  const children = Math.max(0, Number(context.children || 0));
  const vehicles = Math.max(0, Number(context.vehicles || 0));
  const sellingAmountCents = toCents(context.sellingAmount);

  if (basis === "fixed_per_booking" || basis === "per_group" || basis === "manual") return amountCents;
  if (basis === "per_participant") return amountCents * participants;
  if (basis === "per_adult") return amountCents * adults;
  if (basis === "per_child") return amountCents * children;
  if (basis === "per_vehicle") return amountCents * vehicles;
  if (basis === "percentage") return Math.round((sellingAmountCents * toNumber(line.percentage)) / 100);
  if (basis === "tiered") {
    const tier = asArray(line.tiers).find((row) => {
      const min = Math.max(0, Number(row.min || 0));
      const max = row.max === null || row.max === undefined || row.max === "" ? Number.POSITIVE_INFINITY : Number(row.max);
      return participants >= min && participants <= max;
    });
    return tier ? toCents(tier.amount) : 0;
  }
  return 0;
};

const normalizeCalculationContext = (context = {}) => {
  const adults = Math.max(0, Number(context.adults ?? context.paxSummary?.adults ?? 0));
  const children = Math.max(0, Number(context.children ?? context.paxSummary?.children ?? 0));
  const participants = Math.max(0, Number(context.participants ?? context.paxSummary?.total ?? adults + children));
  return {
    adults,
    children,
    participants,
    vehicles: Math.max(0, Number(context.vehicles ?? context.vehicleCount ?? 0)),
    sellingAmount: roundMoney(context.sellingAmount ?? context.bookingRevenue ?? context.revenue ?? 0)
  };
};

const calculateEstimatedBookingCost = ({ template = {}, costLines = null, context = {} } = {}) => {
  const calculationContext = normalizeCalculationContext(context);
  const lines = asArray(costLines || template.costLines);
  const breakdown = lines.map((line, index) => {
    const amount = fromCents(lineAmountCents(line, calculationContext));
    return {
      lineId: normalizeToken(line.lineId || `line-${index + 1}`),
      category: normalizeToken(line.category || "Cost"),
      basis: normalizeCostBasis(line.basis),
      amount,
      currency: normalizeCurrency(template.currency || context.currency || "USD")
    };
  });
  const totalEstimatedCost = fromCents(breakdown.reduce((sum, line) => sum + toCents(line.amount), 0));

  return {
    totalEstimatedCost,
    currency: normalizeCurrency(template.currency || context.currency || "USD"),
    context: calculationContext,
    breakdown
  };
};

const normalizeCostLine = (line = {}, index = 0) => {
  const basis = normalizeCostBasis(line.basis || "fixed_per_booking");
  if (!COST_BASIS_TYPES.includes(basis)) {
    throw new AppError("Cost basis is not supported for product cost templates.", 422, "COST_TEMPLATE_BASIS_INVALID", {
      basis
    });
  }
  const category = normalizeToken(line.category || line.expenseCategory || "");
  if (!category) {
    throw new AppError("Each cost line must include a cost category.", 422, "COST_TEMPLATE_LINE_CATEGORY_REQUIRED");
  }

  const amount = roundMoney(line.amount);
  const percentage = roundMoney(line.percentage);
  const tiers = asArray(line.tiers)
    .map((tier) => ({
      min: Math.max(0, Number(tier.min || 0)),
      max: tier.max === null || tier.max === undefined || tier.max === "" ? null : Math.max(0, Number(tier.max || 0)),
      amount: roundMoney(tier.amount)
    }))
    .filter((tier) => tier.amount > 0);

  if (basis === "percentage" && percentage <= 0) {
    throw new AppError("Percentage cost lines must include a positive percentage.", 422, "COST_TEMPLATE_PERCENTAGE_REQUIRED");
  }
  if (basis === "tiered" && !tiers.length) {
    throw new AppError("Tiered cost lines must include at least one positive tier.", 422, "COST_TEMPLATE_TIER_REQUIRED");
  }
  if (!["percentage", "tiered"].includes(basis) && amount <= 0) {
    throw new AppError("Cost line amount must be greater than zero.", 422, "COST_TEMPLATE_AMOUNT_REQUIRED");
  }

  return {
    lineId: normalizeToken(line.lineId) || `line-${index + 1}`,
    category,
    expenseCategory: normalizeToken(line.expenseCategory || ""),
    description: normalizeToken(line.description || ""),
    basis,
    appliesTo: normalizeToken(line.appliesTo || "all"),
    amount,
    percentage,
    percentageBase: normalizeCostBasis(line.percentageBase || "selling_amount"),
    tiers,
    supplierId: line.supplierId || null,
    notes: normalizeToken(line.notes || ""),
    sortOrder: Number(line.sortOrder ?? index)
  };
};

const normalizeTemplateForResponse = (template = {}, { includeCostLines = true, exampleContext = null } = {}) => {
  const costLines = asArray(template.costLines).map((line, index) => normalizeCostLineForResponse(line, index));
  const calculation = calculateEstimatedBookingCost({
    template,
    costLines,
    context: exampleContext || { adults: 2, children: 0, participants: 2, vehicles: 1, sellingAmount: 0 }
  });

  return {
    id: getId(template),
    bokunProductId: normalizeToken(template.bokunProductId),
    bokunProductTitle: normalizeToken(template.bokunProductTitle),
    bokunProductImage: normalizeToken(template.bokunProductImage),
    bokunOptionId: normalizeToken(template.bokunOptionId),
    bokunOptionTitle: normalizeToken(template.bokunOptionTitle),
    pricingCategoryId: normalizeToken(template.pricingCategoryId),
    pricingCategoryTitle: normalizeToken(template.pricingCategoryTitle),
    currency: normalizeCurrency(template.currency || "USD"),
    name: normalizeToken(template.name),
    description: normalizeToken(template.description),
    internalNotes: normalizeToken(template.internalNotes),
    status: normalizeTemplateStatus(template.status || "draft"),
    version: Number(template.version || 1),
    validFrom: toIso(template.validFrom),
    validTo: toIso(template.validTo),
    costLineCount: costLines.length,
    estimatedCostExample: calculation.totalEstimatedCost,
    createdAt: toIso(template.createdAt),
    updatedAt: toIso(template.updatedAt),
    archivedAt: toIso(template.archivedAt),
    ...(includeCostLines ? { costLines } : {})
  };
};

const normalizeCostLineForResponse = (line = {}, index = 0) => ({
  lineId: normalizeToken(line.lineId || `line-${index + 1}`),
  category: normalizeToken(line.category),
  expenseCategory: normalizeToken(line.expenseCategory),
  description: normalizeToken(line.description),
  basis: normalizeCostBasis(line.basis),
  appliesTo: normalizeToken(line.appliesTo || "all"),
  amount: roundMoney(line.amount),
  percentage: roundMoney(line.percentage),
  percentageBase: normalizeCostBasis(line.percentageBase || "selling_amount"),
  tiers: asArray(line.tiers).map((tier) => ({
    min: Number(tier.min || 0),
    max: tier.max === null || tier.max === undefined || tier.max === "" ? null : Number(tier.max || 0),
    amount: roundMoney(tier.amount)
  })),
  supplierId: normalizeToken(line.supplierId),
  notes: normalizeToken(line.notes),
  sortOrder: Number(line.sortOrder ?? index)
});

const effectiveDateRange = ({ validFrom = null, validTo = null } = {}) => {
  const start = toDate(validFrom) || new Date("1970-01-01T00:00:00.000Z");
  const end = toDate(validTo) || OPEN_ENDED_DATE;
  return { start, end };
};

const periodsOverlap = (left = {}, right = {}) => {
  const leftRange = effectiveDateRange(left);
  const rightRange = effectiveDateRange(right);
  return leftRange.start <= rightRange.end && rightRange.start <= leftRange.end;
};

const isTemplateEffective = (template = {}, asOf = new Date()) => {
  const { start, end } = effectiveDateRange(template);
  const date = toDate(asOf) || new Date();
  return start <= date && date <= end;
};

const buildMap = (records = [], keyFn) =>
  records.reduce((map, record) => {
    const key = normalizeToken(keyFn(record));
    if (!key) return map;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(record);
    return map;
  }, new Map());

const latestByDate = (records = []) =>
  [...records].sort((left, right) => {
    const rightDate = toDate(right?.updatedAt || right?.createdAt || right?.paidAt)?.getTime() || 0;
    const leftDate = toDate(left?.updatedAt || left?.createdAt || left?.paidAt)?.getTime() || 0;
    return rightDate - leftDate;
  })[0] || null;

const isPaidPayment = (payment = {}) =>
  normalizeLower(payment.status) === "paid" ||
  normalizeLower(payment.paymentStatus) === "paid" ||
  normalizeLower(payment.verificationStatus) === "verified" ||
  toNumber(payment.amountPaid || payment.paidAmount) > 0;

const isCompletedRefund = (refund = {}) =>
  ["refunded", "partially_refunded"].includes(normalizeLower(refund.status));

const getPaymentPaidAmount = (payment = {}) =>
  roundMoney(payment.amountPaid ?? payment.paidAmount ?? payment.accountingAmount ?? payment.chargedAmount ?? payment.amount);

const getRefundConfirmedAmount = (refund = {}) =>
  roundMoney(
    refund.confirmedRefundedAmount ??
      refund.confirmedAccountingRefundedAmount ??
      refund.confirmedProviderRefundedAmount ??
      0
  );

const getInvoiceTotal = (invoice = {}) => roundMoney(invoice.totalAmount ?? invoice.total ?? 0);
const getInvoicePaid = (invoice = {}) => roundMoney(invoice.paidAccountingAmount ?? invoice.amountPaid ?? 0);
const getInvoiceRefunded = (invoice = {}) => roundMoney(invoice.refundedAccountingAmount ?? invoice.amountRefunded ?? 0);

const getPrimaryCurrency = (...records) => {
  for (const record of records) {
    const currency = normalizeUpper(
      record?.accountingCurrency ||
        record?.currency ||
        record?.baseCurrency ||
        record?.chargedCurrency ||
        record?.orderCurrency ||
        record?.requestedRefundCurrency
    );
    if (currency) return currency;
  }
  return "USD";
};

const getFinancialDate = ({ booking = null, invoice = null, payments = [], expenses = [] } = {}) =>
  toDate(invoice?.issueDate) ||
  toDate(booking?.bokunOperationalDates?.travelDate?.normalizedAt) ||
  toDate(booking?.bokunOperationalDates?.travelDate?.normalizedDate) ||
  toDate(booking?.bokunOperationalDates?.activityDate?.normalizedAt) ||
  toDate(booking?.travelDate) ||
  toDate(asArray(payments)[0]?.paidAt) ||
  toDate(asArray(expenses)[0]?.expenseDate) ||
  toDate(booking?.createdAt) ||
  toDate(invoice?.createdAt) ||
  null;

const getBookingSalesChannel = (booking = {}, invoice = {}, payment = {}) => {
  const raw =
    booking?.salesChannel ||
    booking?.sourceChannel ||
    booking?.rawChannelSource?.salesChannel ||
    booking?.rawChannelSource?.channel ||
    invoice?.salesChannel ||
    payment?.salesChannel ||
    "OTHER";
  return normalizeChannel(raw || "OTHER");
};

const getParticipantContextFromBooking = (booking = {}, sellingAmount = 0) => {
  const paxSummary = booking?.paxSummary || {};
  const categoryParticipants = asArray(booking?.priceCategoryParticipants);
  const adultsFromCategories = categoryParticipants.reduce((sum, category) => {
    const type = normalizeUpper(category?.ticketCategory || category?.category || category?.title);
    if (!type.includes("ADULT")) return sum;
    return sum + Math.max(0, Number(category?.quantity || category?.count || category?.participants || 0));
  }, 0);
  const childrenFromCategories = categoryParticipants.reduce((sum, category) => {
    const type = normalizeUpper(category?.ticketCategory || category?.category || category?.title);
    if (!type.includes("CHILD")) return sum;
    return sum + Math.max(0, Number(category?.quantity || category?.count || category?.participants || 0));
  }, 0);
  const adults = Math.max(0, Number(paxSummary.adults ?? adultsFromCategories ?? 0));
  const children = Math.max(0, Number(paxSummary.children ?? childrenFromCategories ?? 0));
  const categoryParticipantTotal = categoryParticipants.reduce(
    (sum, category) => sum + Math.max(0, Number(category?.quantity || category?.count || 0)),
    0
  );
  const participantFallback = adults + children;
  const participants = Math.max(
    0,
    Number((paxSummary.total ?? paxSummary.participants ?? booking?.participants ?? categoryParticipantTotal) || participantFallback)
  );
  const vehicles = Math.max(
    0,
    Number(
      booking?.vehicleCount ??
        booking?.assignmentSnapshot?.vehicleCount ??
        asArray(booking?.vehicles).length ??
        asArray(booking?.assignedVehicles).length ??
        0
    )
  );

  return {
    adults,
    children,
    participants,
    vehicles,
    sellingAmount
  };
};

const resolveBookingCostTemplate = ({ booking = {}, templates = [], asOfDate = new Date() } = {}) => {
  const bokunProductId = normalizeToken(booking?.bokunProductId);
  const bokunOptionId = normalizeToken(booking?.bokunOptionId);
  if (!bokunProductId || !bokunOptionId) return null;

  return asArray(templates)
    .filter(
      (template) =>
        normalizeTemplateStatus(template.status) === "active" &&
        sameToken(template.bokunProductId, bokunProductId) &&
        sameToken(template.bokunOptionId, bokunOptionId) &&
        isTemplateEffective(template, asOfDate)
    )
    .sort((left, right) => {
      const rightDate = toDate(right.updatedAt || right.validFrom)?.getTime() || 0;
      const leftDate = toDate(left.updatedAt || left.validFrom)?.getTime() || 0;
      return rightDate - leftDate;
    })[0] || null;
};

const estimateDirectCost = ({ booking = {}, templates = [], bookedRevenue = 0, currency = "USD", asOfDate = new Date() } = {}) => {
  const template = resolveBookingCostTemplate({ booking, templates, asOfDate });
  if (!template) {
    return {
      estimatedDirectCost: 0,
      costTemplateId: "",
      costTemplateName: "",
      costTemplateCurrency: currency
    };
  }
  const calculation = calculateEstimatedBookingCost({
    template,
    context: {
      ...getParticipantContextFromBooking(booking, bookedRevenue),
      currency
    }
  });
  return {
    estimatedDirectCost: roundMoney(calculation.totalEstimatedCost),
    costTemplateId: getId(template),
    costTemplateName: normalizeToken(template.name),
    costTemplateCurrency: calculation.currency
  };
};

const matchesDashboardFilters = (item = {}, filters = {}, range = null) => {
  const requestedChannel = normalizeToken(filters.channel || filters.salesChannel);
  const requestedCurrency = normalizeToken(filters.currency);
  if (requestedChannel && normalizeChannel(item.salesChannel) !== normalizeChannel(requestedChannel)) return false;
  if (requestedCurrency && normalizeCurrency(item.currency) !== normalizeCurrency(requestedCurrency)) return false;
  if (!dateInRange(item.financialDate, range)) return false;
  return true;
};

const compareNumber = (current = 0, previous = 0) => {
  const currentValue = roundMoney(current);
  const previousValue = roundMoney(previous);
  if (!previousValue) {
    return {
      value: currentValue,
      previousValue,
      changePercent: currentValue ? 100 : 0,
      direction: currentValue ? "up" : "flat"
    };
  }
  const changePercent = Number((((currentValue - previousValue) / Math.abs(previousValue)) * 100).toFixed(2));
  return {
    value: currentValue,
    previousValue,
    changePercent,
    direction: changePercent > 0 ? "up" : changePercent < 0 ? "down" : "flat"
  };
};

const summarizeProfitabilityItems = (items = []) => {
  const totals = asArray(items).reduce(
    (summary, item) => {
      summary.bookedRevenue += item.bookedRevenue;
      summary.collectedRevenue += item.collectedRevenue;
      summary.refundedAmount += item.refundedAmount;
      summary.paymentProviderFees += item.paymentProviderFees;
      summary.actualDirectCost += item.actualDirectCost;
      summary.estimatedDirectCost += item.estimatedDirectCost;
      summary.netRevenue += item.netRevenue;
      summary.grossProfit += item.grossProfit;
      summary.dashboardGrossProfit += item.dashboardGrossProfit;
      return summary;
    },
    {
      bookedRevenue: 0,
      collectedRevenue: 0,
      refundedAmount: 0,
      paymentProviderFees: 0,
      actualDirectCost: 0,
      estimatedDirectCost: 0,
      netRevenue: 0,
      grossProfit: 0,
      dashboardGrossProfit: 0
    }
  );
  Object.keys(totals).forEach((key) => {
    totals[key] = roundMoney(totals[key]);
  });
  totals.profitMargin = totals.netRevenue > 0 ? Number(((totals.grossProfit / totals.netRevenue) * 100).toFixed(2)) : 0;
  totals.dashboardProfitMargin =
    totals.bookedRevenue > 0 ? Number(((totals.dashboardGrossProfit / totals.bookedRevenue) * 100).toFixed(2)) : 0;
  return totals;
};

const buildChannelOptions = (items = []) => {
  const byChannel = new Map();
  asArray(items).forEach((item) => {
    const value = normalizeChannel(item.salesChannel || "OTHER");
    const current = byChannel.get(value) || {
      value,
      label: channelLabel(value),
      count: 0,
      revenue: 0,
      currency: item.currency || "USD"
    };
    current.count += 1;
    current.revenue += toNumber(item.bookedRevenue);
    byChannel.set(value, current);
  });
  return Array.from(byChannel.values())
    .map((row) => ({ ...row, revenue: roundMoney(row.revenue) }))
    .sort((left, right) => right.revenue - left.revenue || left.label.localeCompare(right.label));
};

const groupKeyForDate = (value, bucket = "day") => {
  const date = toDate(value);
  if (!date) return "undated";
  if (bucket === "month") return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  if (bucket === "week") {
    const start = startOfDay(date);
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    return toIso(start).slice(0, 10);
  }
  return toIso(date).slice(0, 10);
};

const chooseTimeBucket = (range = null) => {
  if (!range?.from || !range?.to) return "month";
  const days = Math.max(1, Math.ceil((range.to.getTime() - range.from.getTime() + 1) / DAY_MS));
  if (days > 95) return "month";
  if (days > 31) return "week";
  return "day";
};

const buildTrend = (items = [], range = null, bucket = chooseTimeBucket(range)) => {
  const byKey = new Map();
  asArray(items).forEach((item) => {
    const key = groupKeyForDate(item.financialDate, bucket);
    const current = byKey.get(key) || {
      key,
      label: key === "undated" ? "Undated" : key,
      revenue: 0,
      directCosts: 0,
      grossProfit: 0,
      margin: 0,
      count: 0,
      currency: item.currency || "USD"
    };
    current.revenue += toNumber(item.bookedRevenue);
    current.directCosts += toNumber(item.actualDirectCost);
    current.count += 1;
    byKey.set(key, current);
  });
  return Array.from(byKey.values())
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((row) => {
      const revenue = roundMoney(row.revenue);
      const directCosts = roundMoney(row.directCosts);
      const grossProfit = roundMoney(revenue - directCosts);
      return {
        ...row,
        revenue,
        directCosts,
        grossProfit,
        margin: revenue > 0 ? Number(((grossProfit / revenue) * 100).toFixed(2)) : 0
      };
    });
};

const buildRevenueByChannel = (items = []) => {
  const channels = buildChannelOptions(items);
  const totalRevenue = roundMoney(channels.reduce((sum, row) => sum + row.revenue, 0));
  return channels.map((row) => ({
    ...row,
    percent: totalRevenue > 0 ? Number(((row.revenue / totalRevenue) * 100).toFixed(2)) : 0
  }));
};

const buildTopProducts = (items = [], limit = 5) => {
  const byProduct = new Map();
  asArray(items).forEach((item) => {
    const productTitle = normalizeToken(item.productTitle || "Unknown product");
    const current = byProduct.get(productTitle) || {
      productTitle,
      bookingCount: 0,
      revenue: 0,
      directCost: 0,
      profit: 0,
      margin: 0,
      currency: item.currency || "USD"
    };
    current.bookingCount += 1;
    current.revenue += toNumber(item.bookedRevenue);
    current.directCost += toNumber(item.actualDirectCost);
    byProduct.set(productTitle, current);
  });
  return Array.from(byProduct.values())
    .map((row) => {
      const revenue = roundMoney(row.revenue);
      const directCost = roundMoney(row.directCost);
      const profit = roundMoney(revenue - directCost);
      return {
        ...row,
        revenue,
        directCost,
        profit,
        margin: revenue > 0 ? Number(((profit / revenue) * 100).toFixed(2)) : 0
      };
    })
    .sort((left, right) => right.profit - left.profit)
    .slice(0, limit);
};

const financialStatusForItem = (item = {}) => {
  if (item.refundedAmount > 0 && item.refundedAmount >= item.collectedRevenue) return "refunded";
  if (item.refundedAmount > 0) return "partially_refunded";
  if (!item.evidence?.invoice) return "missing_invoice";
  if (item.costStatus === "missing_cost") return "missing_cost";
  if (normalizeLower(item.paymentStatus) === "paid") return "paid";
  if (normalizeLower(item.paymentStatus).includes("partial")) return "partially_paid";
  return normalizeLower(item.paymentStatus || "pending");
};

const getInvoiceBalance = (invoice = {}) =>
  Math.max(0, roundMoney(invoice.balanceDueAmount ?? invoice.balanceDue ?? getInvoiceTotal(invoice) - getInvoicePaid(invoice) + getInvoiceRefunded(invoice)));

const getInvoiceDueDate = (invoice = {}) =>
  toDate(invoice.dueDate || invoice.paymentDueDate || invoice.paymentTerms?.dueDate || invoice.metadata?.dueDate);

const isInvoiceOverdue = (invoice = {}, now = new Date()) => {
  const dueDate = getInvoiceDueDate(invoice);
  return Boolean(dueDate && dueDate < now && getInvoiceBalance(invoice) > 0);
};

const statusMatches = (value = "", candidates = []) => candidates.includes(normalizeLower(value));

const openRefundStatuses = Object.freeze([
  "requested",
  "eligible",
  "pending_approval",
  "approved",
  "awaiting_merchant_approval",
  "processing",
  "verification_required"
]);

const makeKpi = ({ label, value, previousValue = 0, type = "money", tone = "teal", detail = "", href = "" } = {}) => ({
  label,
  value: roundMoney(value),
  previousValue: roundMoney(previousValue),
  type,
  tone,
  detail,
  href,
  comparison: compareNumber(value, previousValue)
});

const buildAttentionItems = ({ items = [], invoices = [], refunds = [], reconciliation = {}, costTemplates = null, currency = "USD" } = {}) => {
  const now = new Date();
  const missingInvoices = asArray(items).filter((item) => !item.evidence?.invoice).length;
  const outstandingInvoices = asArray(invoices).filter((invoice) => getInvoiceBalance(invoice) > 0).length;
  const overdueInvoices = asArray(invoices).filter((invoice) => isInvoiceOverdue(invoice, now)).length;
  const missingActualCosts = asArray(items).filter((item) => item.actualDirectCost <= 0 && item.estimatedDirectCost > 0).length;
  const missingCostTemplates = Number(costTemplates?.summary?.missingCost || 0);
  const openRefunds = asArray(refunds).filter((refund) => openRefundStatuses.includes(normalizeLower(refund.status))).length;
  const unreconciled = Number(reconciliation?.count || 0);

  return [
    {
      id: "missing-invoices",
      label: "Missing Invoices",
      count: missingInvoices,
      severity: missingInvoices ? "danger" : "success",
      href: "/admin/booking-accounting/reconciliation",
      description: "Confirmed booking rows without invoice evidence."
    },
    {
      id: "outstanding-payments",
      label: "Outstanding Payments",
      count: outstandingInvoices,
      severity: outstandingInvoices ? "warning" : "success",
      href: "/admin/booking-accounting/invoices",
      description: "Invoices with remaining balance."
    },
    {
      id: "missing-cost-templates",
      label: "Missing Cost Templates",
      count: missingCostTemplates,
      severity: missingCostTemplates ? "warning" : "success",
      href: "/admin/booking-accounting/cost-templates",
      description: "Bokun options without active cost templates."
    },
    {
      id: "missing-actual-costs",
      label: "Missing Actual Costs",
      count: missingActualCosts,
      severity: missingActualCosts ? "info" : "success",
      href: "/admin/booking-accounting/expenses",
      description: "Rows using estimated costs until actual expenses are posted."
    },
    {
      id: "overdue-invoices",
      label: "Overdue Invoices",
      count: overdueInvoices,
      severity: overdueInvoices ? "danger" : "success",
      href: "/admin/booking-accounting/invoices",
      description: "Outstanding invoices past a stored due date.",
      currency
    },
    {
      id: "unreconciled-items",
      label: "Unreconciled Items",
      count: unreconciled,
      severity: unreconciled ? "warning" : "success",
      href: "/admin/booking-accounting/reconciliation",
      description: "Booking, invoice, payment, refund or expense mismatches."
    },
    {
      id: "refund-review",
      label: "Refunds Requiring Review",
      count: openRefunds,
      severity: openRefunds ? "warning" : "success",
      href: "/admin/booking-accounting/refunds",
      description: "Refund requests not yet confirmed as completed."
    }
  ];
};

const buildRecentFinancialRows = (items = [], limit = 8) =>
  asArray(items)
    .slice()
    .sort((left, right) => (toDate(right.financialDate)?.getTime() || 0) - (toDate(left.financialDate)?.getTime() || 0))
    .slice(0, limit)
    .map((item) => ({
      bookingReference: item.bookingReference,
      productTitle: item.productTitle,
      optionTitle: item.optionTitle,
      salesChannel: item.salesChannel,
      salesChannelLabel: item.salesChannelLabel,
      revenue: item.bookedRevenue,
      collectedRevenue: item.collectedRevenue,
      refundedAmount: item.refundedAmount,
      directCost: item.displayDirectCost,
      actualDirectCost: item.actualDirectCost,
      estimatedDirectCost: item.estimatedDirectCost,
      costStatus: item.costStatus,
      profit: item.displayGrossProfit,
      margin: item.displayProfitMargin,
      financialStatus: item.financialStatus,
      date: item.financialDate,
      currency: item.currency
    }));

const buildFooterKpis = ({ items = [], totals = {} } = {}) => {
  const totalBookings = asArray(items).length;
  const confirmedBookings = asArray(items).filter((item) => statusMatches(item.bookingStatus, ["confirmed", "completed"])).length;
  const cancelledBookings = asArray(items).filter((item) => statusMatches(item.bookingStatus, ["cancelled", "canceled"])).length;
  const averageBookingValue = totalBookings ? roundMoney(toNumber(totals.bookedRevenue) / totalBookings) : 0;
  const refundRate =
    toNumber(totals.collectedRevenue) > 0 ? Number(((toNumber(totals.refundedAmount) / toNumber(totals.collectedRevenue)) * 100).toFixed(2)) : 0;
  const collectionRate =
    toNumber(totals.bookedRevenue) > 0 ? Number(((toNumber(totals.collectedRevenue) / toNumber(totals.bookedRevenue)) * 100).toFixed(2)) : 0;

  return {
    totalBookings,
    confirmedBookings,
    cancelledBookings,
    averageBookingValue,
    refundRate,
    collectionRate
  };
};

const buildCurrencySummary = (items = []) => {
  const byCurrency = new Map();
  asArray(items).forEach((item) => {
    const currency = normalizeCurrency(item.currency || "USD");
    const current = byCurrency.get(currency) || {
      currency,
      bookingRevenue: 0,
      collectedRevenue: 0,
      refundedAmount: 0,
      directCosts: 0,
      bookingCount: 0
    };
    current.bookingRevenue += toNumber(item.bookedRevenue);
    current.collectedRevenue += toNumber(item.collectedRevenue);
    current.refundedAmount += toNumber(item.refundedAmount);
    current.directCosts += toNumber(item.actualDirectCost);
    current.bookingCount += 1;
    byCurrency.set(currency, current);
  });
  return Array.from(byCurrency.values()).map((row) => ({
    ...row,
    bookingRevenue: roundMoney(row.bookingRevenue),
    collectedRevenue: roundMoney(row.collectedRevenue),
    refundedAmount: roundMoney(row.refundedAmount),
    directCosts: roundMoney(row.directCosts)
  }));
};

const normalizeInvoice = (invoice = {}) => {
  const currency = getPrimaryCurrency(invoice);
  const total = getInvoiceTotal(invoice);
  const amountPaid = getInvoicePaid(invoice);
  const amountRefunded = getInvoiceRefunded(invoice);
  const netAmountPaid = roundMoney(invoice.netAccountingAmount ?? invoice.netAmountPaid ?? amountPaid - amountRefunded);
  const balanceDue = roundMoney(invoice.balanceDueAmount ?? invoice.balanceDue ?? total - amountPaid + amountRefunded);

  return {
    id: getId(invoice),
    invoiceNumber: invoice.invoiceNumber || "",
    bookingReference: invoice.bookingReference || "",
    clientName: invoice.clientName || "",
    clientEmail: invoice.clientEmail || "",
    tourName: invoice.tourName || "",
    bookedOption: invoice.bookedOption || "",
    paymentStatus: invoice.paymentStatus || "unknown",
    bookingStatus: invoice.bookingStatus || "unknown",
    total,
    amountPaid,
    amountRefunded,
    netAmountPaid,
    balanceDue,
    currency,
    issueDate: toIso(invoice.issueDate || invoice.createdAt),
    dueDate: toIso(invoice.dueDate || invoice.paymentDueDate || invoice.paymentTerms?.dueDate || invoice.metadata?.dueDate),
    updatedAt: toIso(invoice.updatedAt)
  };
};

const normalizeRefund = (refund = {}, { bookingsById = new Map(), paymentsById = new Map(), invoicesById = new Map() } = {}) => {
  const booking = bookingsById.get(normalizeToken(refund.bookingId))?.[0] || null;
  const payment = paymentsById.get(normalizeToken(refund.paymentId))?.[0] || null;
  const invoice = invoicesById.get(normalizeToken(refund.invoiceId))?.[0] || null;
  const requestedAmount = roundMoney(refund.requestedAmount ?? refund.requestedRefundAmount ?? refund.amount ?? 0);
  const confirmedRefundedAmount = getRefundConfirmedAmount(refund);
  const currency = getPrimaryCurrency(refund, payment, invoice, booking);

  return {
    id: getId(refund),
    refundReference: refund.refundReference || "",
    bookingReference: booking?.bookingReference || invoice?.bookingReference || payment?.bookingReference || "",
    paymentId: normalizeToken(refund.paymentId),
    invoiceId: normalizeToken(refund.invoiceId),
    status: refund.status || "unknown",
    providerRefundStatus: refund.providerRefundStatus || "",
    provider: refund.provider || payment?.provider || "",
    requestedAmount,
    confirmedRefundedAmount,
    eligibleRefundAmount: refund.eligibleRefundAmount === null ? null : roundMoney(refund.eligibleRefundAmount),
    cancellationFee: refund.cancellationFee === null ? null : roundMoney(refund.cancellationFee),
    currency,
    providerRefundRequestReference: refund.providerRefundRequestReference || "",
    providerRefundReference: refund.providerRefundReference || "",
    originalTransactionReference: refund.originalTransactionReference || "",
    originalProviderTransactionId: refund.originalProviderTransactionId || "",
    requestedAt: toIso(refund.requestedAt || refund.createdAt),
    approvedAt: toIso(refund.approvedAt),
    processingStartedAt: toIso(refund.processingStartedAt),
    completedAt: toIso(refund.completedAt),
    lastRefundSyncAt: toIso(refund.lastRefundSyncAt),
    failureReason: refund.failureReason || ""
  };
};

const normalizeExpense = (expense = {}) => ({
  id: getId(expense),
  expenseReference: expense.expenseReference || "",
  bookingReference: expense.bookingReference || "",
  category: expense.category || "",
  description: expense.description || "",
  supplierName: expense.supplier?.name || expense.supplier?.supplierId || "",
  amount: roundMoney(expense.amount),
  currency: normalizeUpper(expense.currency || "USD"),
  baseCurrencyAmount: roundMoney(expense.baseCurrencyAmount ?? expense.amount),
  baseCurrency: normalizeUpper(expense.baseCurrency || expense.currency || "USD"),
  paymentStatus: expense.paymentStatus || "",
  status: expense.status || "",
  sourceModule: expense.sourceModule || "",
  sourceReference: expense.sourceReference || "",
  expenseDate: toIso(expense.expenseDate || expense.createdAt),
  dueDate: toIso(expense.dueDate),
  updatedAt: toIso(expense.updatedAt)
});

const bookingLinkedExpenseQuery = (query = {}) => ({
  ...query,
  $or: [
    { bookingReference: { $exists: true, $ne: "" } },
    { bookingId: { $exists: true, $ne: null } },
    { sourceModule: "BOOKING_ACCOUNTING" },
    { sourceModule: "BOOKING" }
  ]
});

const invoiceBalanceMismatch = (invoice = {}) => {
  const total = getInvoiceTotal(invoice);
  const paid = getInvoicePaid(invoice);
  const refunded = getInvoiceRefunded(invoice);
  const balance = roundMoney(invoice.balanceDueAmount ?? invoice.balanceDue ?? total - paid + refunded);
  return Math.abs(roundMoney(total - paid + refunded) - balance) > 0.01;
};

const buildReconciliationIssues = ({ bookings = [], invoices = [], payments = [], refunds = [], expenses = [] } = {}) => {
  const issues = [];
  const bookingsByReference = buildMap(bookings, (booking) => booking.bookingReference);
  const invoicesByReference = buildMap(invoices, (invoice) => invoice.bookingReference);
  const paymentsByReference = buildMap(payments, (payment) => payment.bookingReference);

  bookings.forEach((booking) => {
    const reference = booking.bookingReference || "";
    if ((booking.paymentStatus === "paid" || booking.bookingStatus === "confirmed") && !invoicesByReference.has(reference)) {
      issues.push({
        code: "MISSING_INVOICE",
        severity: "ERROR",
        entityType: "Booking",
        entityId: getId(booking),
        reference,
        message: "Confirmed or paid booking has no linked invoice."
      });
    }
    if (booking.paymentStatus === "paid" && !asArray(paymentsByReference.get(reference)).some(isPaidPayment)) {
      issues.push({
        code: "MISSING_PAYMENT_LINK",
        severity: "ERROR",
        entityType: "Booking",
        entityId: getId(booking),
        reference,
        message: "Booking is marked paid but no successful payment row is linked."
      });
    }
  });

  invoices.forEach((invoice) => {
    const reference = invoice.bookingReference || invoice.invoiceNumber || "";
    if (invoice.paymentStatus === "paid" && !asArray(paymentsByReference.get(invoice.bookingReference)).some(isPaidPayment)) {
      issues.push({
        code: "MISSING_PAYMENT_LINK",
        severity: "ERROR",
        entityType: "Invoice",
        entityId: getId(invoice),
        reference,
        message: "Invoice is marked paid but has no linked successful payment."
      });
    }
    if (invoiceBalanceMismatch(invoice)) {
      issues.push({
        code: "INVOICE_BALANCE_MISMATCH",
        severity: "ERROR",
        entityType: "Invoice",
        entityId: getId(invoice),
        reference,
        message: "Invoice total, paid, refunded and balance fields do not reconcile."
      });
    }
  });

  payments.forEach((payment) => {
    const reference = payment.bookingReference || payment.merchantReference || payment.intentId || "";
    if (payment.bookingReference && !bookingsByReference.has(payment.bookingReference)) {
      issues.push({
        code: "MISSING_BOOKING_LINK",
        severity: "ERROR",
        entityType: "Payment",
        entityId: getId(payment),
        reference,
        message: "Payment points to a booking reference that does not exist locally."
      });
    }
    if (payment.anomaly?.flagged || ["amount_mismatch", "currency_review_required", "reference_mismatch"].includes(payment.verificationStatus)) {
      issues.push({
        code: "PAYMENT_RECONCILIATION_REVIEW",
        severity: "WARNING",
        entityType: "Payment",
        entityId: getId(payment),
        reference,
        message: "Payment has provider/accounting reconciliation evidence that needs review."
      });
    }
  });

  refunds.forEach((refund) => {
    if (isCompletedRefund(refund) && getRefundConfirmedAmount(refund) <= 0) {
      issues.push({
        code: "REFUND_CONFIRMED_AMOUNT_ZERO",
        severity: "ERROR",
        entityType: "Refund",
        entityId: getId(refund),
        reference: refund.refundReference || "",
        message: "Refund is completed but confirmed refunded amount is zero."
      });
    }
  });

  expenses.forEach((expense) => {
    if (expense.bookingReference && !bookingsByReference.has(expense.bookingReference)) {
      issues.push({
        code: "EXPENSE_BOOKING_LINK_MISSING",
        severity: "WARNING",
        entityType: "BusinessExpense",
        entityId: getId(expense),
        reference: expense.bookingReference || expense.expenseReference || "",
        message: "Booking-linked expense points to a booking reference that does not exist locally."
      });
    }
  });

  return issues;
};

const createBookingAccountingService = ({
  AuditLogModel = AuditLog,
  BookingModel = Booking,
  BusinessExpenseModel = BusinessExpense,
  InvoiceModel = Invoice,
  PaymentModel = Payment,
  ProductCostTemplateModel = ProductCostTemplate,
  ProductSnapshotModel = ProductSnapshot,
  RefundModel = Refund,
  ToursService = toursService
} = {}) => {
  let productCatalogSyncInFlight = null;
  let productCatalogSyncStartedAt = null;
  let lastProductCatalogSyncResult = null;

  const recordCostTemplateAudit = async ({
    action,
    template = null,
    before = null,
    after = null,
    auth = {},
    requestId = "",
    reason = "",
    metadata = {}
  }) => {
    if (!AuditLogModel?.create || !template) return null;
    return AuditLogModel.create({
      actorId: auth?.id || null,
      actorRole: auth?.role || "system",
      action,
      entityType: "ProductCostTemplate",
      entityId: getId(template) || normalizeToken(template.id),
      reference: templateIdentityKey(template),
      reason,
      requestId,
      correlationId: requestId,
      before,
      after,
      metadata
    });
  };

  const loadCostTemplateInventory = async () => {
    const [productSnapshots, bookings] = await Promise.all([
      findRows(ProductSnapshotModel, {}, { sort: { title: 1, updatedAt: -1 }, limit: MAX_LIMIT }),
      findRows(
        BookingModel,
        {
          bokunProductId: { $exists: true, $ne: "" },
          bokunOptionId: { $exists: true, $ne: "" }
        },
        { sort: { updatedAt: -1, createdAt: -1 }, limit: MAX_LIMIT }
      )
    ]);
    return buildBokunCostInventory({ productSnapshots, bookings });
  };

  const loadCostTemplates = async () =>
    findRows(ProductCostTemplateModel, {}, { sort: { updatedAt: -1, createdAt: -1 }, limit: MAX_LIMIT });

  const getInventoryOption = (inventory, bokunProductId, bokunOptionId) =>
    asArray(inventory?.options).find(
      (option) => sameToken(option.bokunProductId, bokunProductId) && sameToken(option.bokunOptionId, bokunOptionId)
    ) || null;

  const getPricingCategory = (option = {}, pricingCategoryId = "") => {
    const safeId = normalizeToken(pricingCategoryId);
    if (!safeId) return { pricingCategoryId: "", title: "" };
    return (
      asArray(option.pricingCategories).find((category) => sameToken(category.pricingCategoryId, safeId)) || {
        pricingCategoryId: safeId,
        title: safeId
      }
    );
  };

  const assertValidTemplateDates = ({ validFrom, validTo }) => {
    const from = toDate(validFrom);
    const to = toDate(validTo);
    if (validFrom && !from) {
      throw new AppError("Valid from date is not valid.", 422, "COST_TEMPLATE_VALID_FROM_INVALID");
    }
    if (validTo && !to) {
      throw new AppError("Valid to date is not valid.", 422, "COST_TEMPLATE_VALID_TO_INVALID");
    }
    if (from && to && from > to) {
      throw new AppError("Valid to date must be after valid from date.", 422, "COST_TEMPLATE_DATE_RANGE_INVALID");
    }
  };

  const assertNoActiveOverlap = async ({ templateId = "", bokunProductId, bokunOptionId, pricingCategoryId = "", validFrom, validTo }) => {
    const candidates = await findRows(
      ProductCostTemplateModel,
      {
        bokunProductId: normalizeToken(bokunProductId),
        bokunOptionId: normalizeToken(bokunOptionId),
        pricingCategoryId: normalizeToken(pricingCategoryId),
        status: "active"
      },
      { limit: MAX_LIMIT }
    );
    const conflicting = candidates.find(
      (candidate) => !sameToken(getId(candidate), templateId) && periodsOverlap(candidate, { validFrom, validTo })
    );
    if (conflicting) {
      throw new AppError(
        "An active cost template already covers this Bókun product option and effective period.",
        409,
        "COST_TEMPLATE_ACTIVE_OVERLAP",
        {
          conflictingTemplateId: getId(conflicting),
          bokunProductId: normalizeToken(bokunProductId),
          bokunOptionId: normalizeToken(bokunOptionId),
          pricingCategoryId: normalizeToken(pricingCategoryId)
        }
      );
    }
  };

  const buildTemplatePayload = async (input = {}, { existing = null } = {}) => {
    const inventory = await loadCostTemplateInventory();
    const bokunProductId = normalizeToken(input.bokunProductId ?? existing?.bokunProductId);
    const bokunOptionId = normalizeToken(input.bokunOptionId ?? existing?.bokunOptionId);
    const option = getInventoryOption(inventory, bokunProductId, bokunOptionId);
    const identityChanged =
      !existing ||
      !sameToken(existing.bokunProductId, bokunProductId) ||
      !sameToken(existing.bokunOptionId, bokunOptionId);

    if (!option && identityChanged) {
      throw new AppError(
        "Select a Bókun product option that exists in the synchronized product catalog.",
        422,
        "COST_TEMPLATE_BOKUN_OPTION_REQUIRED",
        { bokunProductId, bokunOptionId }
      );
    }

    const pricingCategory = getPricingCategory(option || {}, input.pricingCategoryId ?? existing?.pricingCategoryId);
    const status = normalizeTemplateStatus(input.status ?? existing?.status ?? "draft");
    if (!TEMPLATE_STATUSES.includes(status)) {
      throw new AppError("Cost template status is not supported.", 422, "COST_TEMPLATE_STATUS_INVALID", { status });
    }
    const validFrom = input.validFrom !== undefined ? toDate(input.validFrom) : toDate(existing?.validFrom) || new Date();
    const validTo = input.validTo !== undefined ? toDate(input.validTo) : toDate(existing?.validTo);
    assertValidTemplateDates({ validFrom, validTo });

    const costLines = asArray(input.costLines ?? existing?.costLines).map(normalizeCostLine);
    if (!costLines.length) {
      throw new AppError("Add at least one cost line before saving a cost template.", 422, "COST_TEMPLATE_LINES_REQUIRED");
    }

    return {
      bokunProductId,
      bokunProductTitle: option?.bokunProductTitle || normalizeToken(input.bokunProductTitle || existing?.bokunProductTitle || bokunProductId),
      bokunProductImage: option?.bokunProductImage || normalizeToken(input.bokunProductImage || existing?.bokunProductImage || ""),
      bokunOptionId,
      bokunOptionTitle: option?.bokunOptionTitle || normalizeToken(input.bokunOptionTitle || existing?.bokunOptionTitle || bokunOptionId),
      pricingCategoryId: pricingCategory.pricingCategoryId,
      pricingCategoryTitle: normalizeToken(pricingCategory.title || input.pricingCategoryTitle || existing?.pricingCategoryTitle || ""),
      currency: normalizeCurrency(input.currency || option?.currency || existing?.currency || "USD"),
      name:
        normalizeToken(input.name) ||
        normalizeToken(existing?.name) ||
        `${option?.bokunProductTitle || bokunProductId} - ${option?.bokunOptionTitle || bokunOptionId}`,
      description: normalizeToken(input.description ?? existing?.description),
      internalNotes: normalizeToken(input.internalNotes ?? existing?.internalNotes),
      status,
      validFrom,
      validTo,
      costLines,
      source: {
        productSnapshotId: normalizeToken(option?.source === "ProductSnapshot" ? option.productSnapshotId : ""),
        productLastSyncedAt: toDate(option?.sourceProductLastSyncedAt),
        identitySource: option?.source || existing?.source?.identitySource || "ProductSnapshot"
      }
    };
  };

  const loadRefundRelations = async (refunds = []) => {
    const bookingIds = refunds.map((refund) => normalizeToken(refund.bookingId)).filter(Boolean);
    const paymentIds = refunds.map((refund) => normalizeToken(refund.paymentId)).filter(Boolean);
    const invoiceIds = refunds.map((refund) => normalizeToken(refund.invoiceId)).filter(Boolean);
    const [bookings, payments, invoices] = await Promise.all([
      bookingIds.length ? findRows(BookingModel, { _id: { $in: bookingIds } }, { limit: MAX_LIMIT }) : [],
      paymentIds.length ? findRows(PaymentModel, { _id: { $in: paymentIds } }, { limit: MAX_LIMIT }) : [],
      invoiceIds.length ? findRows(InvoiceModel, { _id: { $in: invoiceIds } }, { limit: MAX_LIMIT }) : []
    ]);
    return {
      bookingsById: buildMap(bookings, (booking) => getId(booking)),
      paymentsById: buildMap(payments, (payment) => getId(payment)),
      invoicesById: buildMap(invoices, (invoice) => getId(invoice))
    };
  };

  const listInvoices = async (filters = {}) => {
    const { page, limit, skip } = pagination(filters);
    const query = {};
    if (filters.status) query.paymentStatus = filters.status;
    addDateRange(query, "issueDate", filters);
    addRegexSearch(query, ["invoiceNumber", "bookingReference", "clientName", "clientEmail", "tourName"], filters.search);
    const [rows, total] = await Promise.all([
      findRows(InvoiceModel, query, { sort: { issueDate: -1, createdAt: -1 }, skip, limit }),
      countRows(InvoiceModel, query)
    ]);
    return {
      items: rows.map(normalizeInvoice),
      total,
      page,
      limit,
      count: rows.length
    };
  };

  const listRefunds = async (filters = {}) => {
    const { page, limit, skip } = pagination(filters);
    const query = {};
    if (filters.status) query.status = filters.status;
    if (filters.provider) query.provider = normalizeLower(filters.provider);
    addDateRange(query, "createdAt", filters);
    addRegexSearch(
      query,
      [
        "refundReference",
        "providerRefundRequestReference",
        "providerRefundReference",
        "originalTransactionReference",
        "originalProviderTransactionId"
      ],
      filters.search
    );
    const [rows, total] = await Promise.all([
      findRows(RefundModel, query, { sort: { updatedAt: -1, createdAt: -1 }, skip, limit }),
      countRows(RefundModel, query)
    ]);
    const relations = await loadRefundRelations(rows);
    return {
      items: rows.map((refund) => normalizeRefund(refund, relations)),
      total,
      page,
      limit,
      count: rows.length
    };
  };

  const listExpenses = async (filters = {}) => {
    const { page, limit, skip } = pagination(filters);
    let query = bookingLinkedExpenseQuery({});
    if (filters.status) query.status = filters.status;
    if (filters.category) query.category = filters.category;
    addDateRange(query, "expenseDate", filters);
    addRegexSearch(query, ["expenseReference", "bookingReference", "description", "supplier.name"], filters.search);
    const [rows, total] = await Promise.all([
      findRows(BusinessExpenseModel, query, { sort: { expenseDate: -1, createdAt: -1 }, skip, limit }),
      countRows(BusinessExpenseModel, query)
    ]);
    return {
      items: rows.map(normalizeExpense),
      total,
      page,
      limit,
      count: rows.length
    };
  };

  const loadSnapshot = async (filters = {}) => {
    const scanLimit = Math.max(50, Math.min(MAX_LIMIT, Number(filters.limit || 250)));
    const [bookings, invoices, payments, refunds, expenses] = await Promise.all([
      findRows(BookingModel, {}, { sort: { updatedAt: -1, createdAt: -1 }, limit: scanLimit }),
      findRows(InvoiceModel, {}, { sort: { updatedAt: -1, createdAt: -1 }, limit: scanLimit }),
      findRows(PaymentModel, {}, { sort: { updatedAt: -1, createdAt: -1 }, limit: scanLimit }),
      findRows(RefundModel, {}, { sort: { updatedAt: -1, createdAt: -1 }, limit: scanLimit }),
      findRows(BusinessExpenseModel, bookingLinkedExpenseQuery({}), { sort: { updatedAt: -1, createdAt: -1 }, limit: scanLimit })
    ]);
    return { bookings, invoices, payments, refunds, expenses, scanLimit };
  };

  const getProfitability = async (filters = {}) => {
    const { bookings, invoices, payments, refunds, expenses, scanLimit } = await loadSnapshot(filters);
    const templates = await loadCostTemplates();
    const bookingsByReference = buildMap(bookings, (booking) => booking.bookingReference);
    const invoicesByReference = buildMap(invoices, (invoice) => invoice.bookingReference);
    const paymentsByReference = buildMap(payments, (payment) => payment.bookingReference);
    const expensesByReference = buildMap(expenses, (expense) => expense.bookingReference);
    const refundsByPaymentId = buildMap(refunds.filter(isCompletedRefund), (refund) => normalizeToken(refund.paymentId));

    const references = Array.from(
      new Set([
        ...bookings.map((booking) => booking.bookingReference).filter(Boolean),
        ...invoices.map((invoice) => invoice.bookingReference).filter(Boolean),
        ...payments.map((payment) => payment.bookingReference).filter(Boolean),
        ...expenses.map((expense) => expense.bookingReference).filter(Boolean)
      ])
    );

    const rawItems = references.map((bookingReference) => {
      const booking = latestByDate(bookingsByReference.get(bookingReference) || []);
      const invoice = latestByDate(invoicesByReference.get(bookingReference) || []);
      const bookingPayments = paymentsByReference.get(bookingReference) || [];
      const paidPayments = bookingPayments.filter(isPaidPayment);
      const linkedRefunds = paidPayments.flatMap((payment) => refundsByPaymentId.get(getId(payment)) || []);
      const bookingExpenses = expensesByReference.get(bookingReference) || [];
      const currency = getPrimaryCurrency(invoice, booking, paidPayments[0], bookingExpenses[0]);
      const bookedRevenue = roundMoney(invoice ? getInvoiceTotal(invoice) : booking?.pricingSnapshot?.finalPayable ?? booking?.amount ?? 0);
      const collectedRevenue = roundMoney(
        invoice ? getInvoicePaid(invoice) : paidPayments.reduce((sum, payment) => sum + getPaymentPaidAmount(payment), 0)
      );
      const refundedAmount = roundMoney(
        Math.max(
          getInvoiceRefunded(invoice || {}),
          toNumber(booking?.amountRefunded),
          linkedRefunds.reduce((sum, refund) => sum + getRefundConfirmedAmount(refund), 0)
        )
      );
      const paymentProviderFees = roundMoney(paidPayments.reduce((sum, payment) => sum + toNumber(payment.providerFeeAmount), 0));
      const actualDirectCost = roundMoney(
        bookingExpenses.reduce((sum, expense) => sum + toNumber(expense.baseCurrencyAmount ?? expense.amount), 0)
      );
      const financialDate = getFinancialDate({ booking, invoice, payments: bookingPayments, expenses: bookingExpenses });
      const salesChannel = getBookingSalesChannel(booking, invoice, paidPayments[0] || bookingPayments[0]);
      const estimatedCost = estimateDirectCost({
        booking: booking || {},
        templates,
        bookedRevenue,
        currency,
        asOfDate: financialDate || new Date()
      });
      const estimatedDirectCost = estimatedCost.estimatedDirectCost;
      const displayDirectCost = actualDirectCost > 0 ? actualDirectCost : estimatedDirectCost;
      const costStatus = actualDirectCost > 0 ? "actual" : estimatedDirectCost > 0 ? "estimated" : "missing_cost";
      const netRevenue = roundMoney(collectedRevenue - refundedAmount - paymentProviderFees);
      const grossProfit = roundMoney(netRevenue - actualDirectCost);
      const profitMargin = netRevenue > 0 ? Number(((grossProfit / netRevenue) * 100).toFixed(2)) : 0;
      const dashboardGrossProfit = roundMoney(bookedRevenue - actualDirectCost);
      const dashboardProfitMargin = bookedRevenue > 0 ? Number(((dashboardGrossProfit / bookedRevenue) * 100).toFixed(2)) : 0;
      const displayGrossProfit = roundMoney(bookedRevenue - displayDirectCost);
      const displayProfitMargin = bookedRevenue > 0 ? Number(((displayGrossProfit / bookedRevenue) * 100).toFixed(2)) : 0;

      return {
        bookingReference,
        productTitle: booking?.productTitle || invoice?.tourName || "",
        optionTitle: booking?.optionTitle || invoice?.bookedOption || "",
        bokunProductId: normalizeToken(booking?.bokunProductId),
        bokunOptionId: normalizeToken(booking?.bokunOptionId),
        salesChannel,
        salesChannelLabel: channelLabel(salesChannel),
        bookingStatus: booking?.bookingStatus || invoice?.bookingStatus || "",
        paymentStatus: booking?.paymentStatus || invoice?.paymentStatus || "",
        currency,
        financialDate: toIso(financialDate),
        bookedRevenue,
        collectedRevenue,
        refundedAmount,
        paymentProviderFees,
        actualDirectCost,
        estimatedDirectCost,
        displayDirectCost,
        costStatus,
        costTemplateId: estimatedCost.costTemplateId,
        costTemplateName: estimatedCost.costTemplateName,
        netRevenue,
        grossProfit,
        profitMargin,
        dashboardGrossProfit,
        dashboardProfitMargin,
        displayGrossProfit,
        displayProfitMargin,
        evidence: {
          invoice: Boolean(invoice),
          successfulPaymentCount: paidPayments.length,
          completedRefundCount: linkedRefunds.length,
          bookingLinkedExpenseCount: bookingExpenses.length,
          costTemplate: Boolean(estimatedCost.costTemplateId)
        },
        financialStatus: financialStatusForItem({
          refundedAmount,
          collectedRevenue,
          paymentStatus: booking?.paymentStatus || invoice?.paymentStatus || "",
          costStatus,
          evidence: { invoice: Boolean(invoice) }
        })
      };
    });

    const range = resolveDashboardRange(filters).current;
    const search = normalizeLower(filters.search);
    const status = normalizeLower(filters.status);
    const items = rawItems.filter((item) => {
      if (!matchesDashboardFilters(item, filters, range)) return false;
      if (status && normalizeLower(item.bookingStatus) !== status && normalizeLower(item.paymentStatus) !== status) return false;
      if (!search) return true;
      return `${item.bookingReference} ${item.productTitle} ${item.optionTitle} ${item.salesChannelLabel}`
        .toLowerCase()
        .includes(search);
    });

    const totals = summarizeProfitabilityItems(items);

    return {
      generatedAt: new Date().toISOString(),
      scan: { limit: scanLimit, boundedScan: true },
      totals,
      currency: items[0]?.currency || rawItems[0]?.currency || "USD",
      items: items
        .sort((left, right) => right.netRevenue - left.netRevenue)
        .slice(0, pagination(filters).limit),
      count: items.length,
      filters: {
        channels: buildChannelOptions(rawItems),
        range: resolveDashboardRange(filters)
      }
    };
  };

  const getReconciliation = async (filters = {}) => {
    const { bookings, invoices, payments, refunds, expenses, scanLimit } = await loadSnapshot(filters);
    const issues = buildReconciliationIssues({ bookings, invoices, payments, refunds, expenses });
    const search = normalizeLower(filters.search);
    const severity = normalizeUpper(filters.severity);
    const filtered = issues.filter((issue) => {
      if (severity && issue.severity !== severity) return false;
      if (!search) return true;
      return `${issue.code} ${issue.entityType} ${issue.reference} ${issue.message}`.toLowerCase().includes(search);
    });
    return {
      generatedAt: new Date().toISOString(),
      scan: { limit: scanLimit, boundedScan: true },
      items: filtered.slice(0, pagination(filters).limit),
      count: filtered.length,
      summary: {
        totalIssues: filtered.length,
        critical: filtered.filter((issue) => issue.severity === "CRITICAL").length,
        errors: filtered.filter((issue) => issue.severity === "ERROR").length,
        warnings: filtered.filter((issue) => issue.severity === "WARNING").length
      }
    };
  };

  const getDashboard = async (filters = {}) => {
    const range = resolveDashboardRange(filters);
    const previousFilters = range.previous
      ? {
          ...filters,
          fromDate: range.previous.from.toISOString(),
          toDate: range.previous.to.toISOString(),
          limit: MAX_LIMIT
        }
      : null;

    const [invoices, refunds, expenses, profitability, previousProfitability, reconciliation, costTemplates] = await Promise.all([
      listInvoices({ ...filters, limit: MAX_LIMIT }),
      listRefunds({ ...filters, limit: MAX_LIMIT }),
      listExpenses({ ...filters, limit: MAX_LIMIT }),
      getProfitability({ ...filters, limit: MAX_LIMIT }),
      previousFilters ? getProfitability(previousFilters) : Promise.resolve({ totals: summarizeProfitabilityItems([]) }),
      getReconciliation({ ...filters, limit: MAX_LIMIT }),
      getCostTemplates({ limit: DEFAULT_TEMPLATE_LIMIT })
    ]);

    const selectedChannel = normalizeToken(filters.channel || filters.salesChannel);
    const visibleReferences = new Set(profitability.items.map((item) => normalizeToken(item.bookingReference)).filter(Boolean));
    const inSelectedScope = (bookingReference = "") => {
      if (!selectedChannel) return true;
      return visibleReferences.has(normalizeToken(bookingReference));
    };
    const scopedInvoices = invoices.items.filter((invoice) => inSelectedScope(invoice.bookingReference));
    const scopedRefunds = refunds.items.filter((refund) => inSelectedScope(refund.bookingReference));
    const scopedExpenses = expenses.items.filter((expense) => inSelectedScope(expense.bookingReference));
    const scopedReconciliationItems = selectedChannel
      ? reconciliation.items.filter((issue) => inSelectedScope(issue.reference))
      : reconciliation.items;
    const scopedReconciliation = {
      ...reconciliation,
      items: scopedReconciliationItems,
      count: selectedChannel ? scopedReconciliationItems.length : reconciliation.count
    };

    const openRefunds = scopedRefunds.filter((refund) =>
      openRefundStatuses.includes(normalizeLower(refund.status))
    );
    const overdueInvoices = scopedInvoices.filter((invoice) => isInvoiceOverdue(invoice));
    const outstandingAmount = roundMoney(scopedInvoices.reduce((sum, invoice) => sum + getInvoiceBalance(invoice), 0));
    const overdueAmount = roundMoney(overdueInvoices.reduce((sum, invoice) => sum + getInvoiceBalance(invoice), 0));
    const bookingRevenue = profitability.totals.bookedRevenue;
    const collectedRevenue = profitability.totals.collectedRevenue;
    const directCosts = profitability.totals.actualDirectCost;
    const dashboardGrossProfit = roundMoney(bookingRevenue - directCosts);
    const dashboardProfitMargin = bookingRevenue > 0 ? Number(((dashboardGrossProfit / bookingRevenue) * 100).toFixed(2)) : 0;
    const previousBookingRevenue = previousProfitability.totals.bookedRevenue || 0;
    const previousCollectedRevenue = previousProfitability.totals.collectedRevenue || 0;
    const previousDirectCosts = previousProfitability.totals.actualDirectCost || 0;
    const previousGrossProfit = roundMoney(previousBookingRevenue - previousDirectCosts);
    const previousProfitMargin =
      previousBookingRevenue > 0 ? Number(((previousGrossProfit / previousBookingRevenue) * 100).toFixed(2)) : 0;
    const recentBookingFinancials = buildRecentFinancialRows(profitability.items, 8);
    const revenueVsCosts = buildTrend(profitability.items, range.current);
    const profitabilityOverview = buildTrend(profitability.items, range.current, chooseTimeBucket(range.current));
    const revenueByChannel = buildRevenueByChannel(profitability.items);
    const topProducts = buildTopProducts(profitability.items, 5);
    const footerKpis = buildFooterKpis({ items: profitability.items, totals: profitability.totals });
    const currencySummary = buildCurrencySummary(profitability.items);
    const currency = profitability.currency;
    const needsAttention = buildAttentionItems({
      items: profitability.items,
      invoices: scopedInvoices,
      refunds: scopedRefunds,
      reconciliation: scopedReconciliation,
      costTemplates,
      currency
    });

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        invoiceCount: selectedChannel ? scopedInvoices.length : invoices.total,
        refundCount: selectedChannel ? scopedRefunds.length : refunds.total,
        bookingExpenseCount: selectedChannel ? scopedExpenses.length : expenses.total,
        openRefundCount: openRefunds.length,
        reconciliationIssueCount: scopedReconciliation.count,
        collectedRevenue: profitability.totals.collectedRevenue,
        confirmedRefundedAmount: profitability.totals.refundedAmount,
        netRevenue: profitability.totals.netRevenue,
        grossProfit: profitability.totals.grossProfit,
        profitMargin: profitability.totals.profitMargin,
        bookingRevenue,
        directCosts,
        dashboardGrossProfit,
        dashboardProfitMargin,
        outstandingAmount,
        overdueAmount
      },
      currency,
      summaryKpis: {
        bookingRevenue: makeKpi({
          label: "Booking Revenue",
          value: bookingRevenue,
          previousValue: previousBookingRevenue,
          tone: "green",
          detail: "Recognized booking revenue",
          href: "/admin/booking-accounting/profitability"
        }),
        collectedRevenue: makeKpi({
          label: "Collected Revenue",
          value: collectedRevenue,
          previousValue: previousCollectedRevenue,
          tone: "teal",
          detail: "Successfully collected",
          href: "/admin/booking-accounting/payments"
        }),
        directCosts: makeKpi({
          label: "Direct Costs",
          value: directCosts,
          previousValue: previousDirectCosts,
          tone: "red",
          detail: "Actual booking-linked expenses",
          href: "/admin/booking-accounting/expenses"
        }),
        grossProfit: makeKpi({
          label: "Gross Profit",
          value: dashboardGrossProfit,
          previousValue: previousGrossProfit,
          tone: "purple",
          detail: "Booking revenue minus actual direct costs",
          href: "/admin/booking-accounting/profitability"
        })
      },
      secondaryKpis: {
        profitMargin: makeKpi({
          label: "Profit Margin",
          value: dashboardProfitMargin,
          previousValue: previousProfitMargin,
          type: "percent",
          tone: "purple",
          detail: "Gross profit over booking revenue"
        }),
        outstandingAmount: makeKpi({
          label: "Outstanding Amount",
          value: outstandingAmount,
          type: "money",
          tone: "orange",
          detail: `${scopedInvoices.filter((invoice) => getInvoiceBalance(invoice) > 0).length} invoices`,
          href: "/admin/booking-accounting/invoices"
        }),
        refunds: makeKpi({
          label: "Refunds",
          value: profitability.totals.refundedAmount,
          type: "money",
          tone: "blue",
          detail: `${selectedChannel ? scopedRefunds.length : refunds.total || 0} refund records`,
          href: "/admin/booking-accounting/refunds"
        }),
        unreconciledItems: makeKpi({
          label: "Unreconciled Items",
          value: scopedReconciliation.count,
          type: "count",
          tone: scopedReconciliation.count ? "orange" : "green",
          detail: scopedReconciliation.count ? "Needs attention" : "No issues in scan",
          href: "/admin/booking-accounting/reconciliation"
        }),
        overdueAmount: makeKpi({
          label: "Overdue Amount",
          value: overdueAmount,
          type: "money",
          tone: overdueAmount ? "red" : "green",
          detail: `${overdueInvoices.length} overdue invoices`,
          href: "/admin/booking-accounting/invoices"
        })
      },
      charts: {
        revenueVsCosts,
        revenueByChannel,
        profitabilityOverview
      },
      recentBookingFinancials,
      needsAttention,
      topProducts,
      footerKpis,
      currencySummary,
      currencyWarning:
        currencySummary.length > 1
          ? "Multiple currencies are present in this bounded scan. Dashboard totals use each record's accounting currency fields; review currency groups before external reporting."
          : "",
      costTemplateCoverage: costTemplates.summary,
      filters: {
        applied: {
          fromDate: filters.fromDate || "",
          toDate: filters.toDate || "",
          channel: normalizeToken(filters.channel || filters.salesChannel || ""),
          currency: normalizeToken(filters.currency || "")
        },
        range,
        channels: profitability.filters?.channels || []
      },
      definitions: {
        bookingRevenue: "Sum of booked/invoiced revenue in the selected booking accounting scan.",
        collectedRevenue: "Sum of invoice paid amount or successful linked payment amount.",
        directCosts: "Only actual booking-linked BusinessExpense records.",
        dashboardGrossProfit: "Booking revenue minus actual direct booking costs.",
        refundRate: "Confirmed refunded amount divided by collected revenue.",
        collectionRate: "Collected revenue divided by booking revenue."
      },
      recentInvoices: scopedInvoices.slice(0, 10),
      recentRefunds: scopedRefunds.slice(0, 10),
      recentExpenses: scopedExpenses.slice(0, 10),
      profitability: profitability.items.slice(0, 10),
      reconciliation: scopedReconciliation.items.slice(0, 10)
    };
  };

  const buildCostTemplateRows = ({ inventory, templates }) => {
    const now = new Date();
    return asArray(inventory.options).map((option) => {
      const optionTemplates = asArray(templates)
        .filter(
          (template) =>
            sameToken(template.bokunProductId, option.bokunProductId) &&
            sameToken(template.bokunOptionId, option.bokunOptionId) &&
            normalizeTemplateStatus(template.status) !== "archived"
        )
        .sort((left, right) => (toDate(right.updatedAt)?.getTime() || 0) - (toDate(left.updatedAt)?.getTime() || 0));
      const activeTemplates = optionTemplates.filter(
        (template) => normalizeTemplateStatus(template.status) === "active" && isTemplateEffective(template, now)
      );
      const primaryTemplate = activeTemplates[0] || optionTemplates[0] || null;
      const costStatus = activeTemplates.length ? "costed" : "missing_cost";
      const calculation = primaryTemplate
        ? calculateEstimatedBookingCost({
            template: primaryTemplate,
            context: { adults: 2, children: 0, participants: 2, vehicles: 1, sellingAmount: 0 }
          })
        : null;

      return {
        id: option.id,
        rowType: "bokun_option",
        bokunProductId: option.bokunProductId,
        bokunProductTitle: option.bokunProductTitle,
        bokunProductImage: option.bokunProductImage,
        bokunOptionId: option.bokunOptionId,
        bokunOptionTitle: option.bokunOptionTitle,
        pricingCategoryId: primaryTemplate?.pricingCategoryId || "",
        pricingCategoryTitle:
          primaryTemplate?.pricingCategoryTitle ||
          (option.pricingCategories?.length > 1 ? "Multiple categories" : option.pricingCategories?.[0]?.title || ""),
        currency: primaryTemplate?.currency || option.currency || "USD",
        costStatus,
        templateStatus: primaryTemplate ? normalizeTemplateStatus(primaryTemplate.status) : "missing_cost",
        templateId: primaryTemplate ? getId(primaryTemplate) : "",
        templateName: primaryTemplate?.name || "",
        costBasis:
          primaryTemplate?.costLines?.length
            ? [...new Set(primaryTemplate.costLines.map((line) => normalizeCostBasis(line.basis)).filter(Boolean))].join(", ")
            : "",
        estimatedCostExample: calculation?.totalEstimatedCost ?? null,
        costLineCount: primaryTemplate?.costLines?.length || 0,
        activeTemplateCount: activeTemplates.length,
        templateCount: optionTemplates.length,
        lastUpdatedAt: primaryTemplate ? toIso(primaryTemplate.updatedAt || primaryTemplate.createdAt) : "",
        source: option.source
      };
    });
  };

  const applyCostTemplateFilters = (rows = [], filters = {}) => {
    const search = normalizeLower(filters.search);
    const productId = normalizeToken(filters.productId || filters.bokunProductId);
    const optionId = normalizeToken(filters.optionId || filters.bokunOptionId);
    const costStatus = normalizeCostBasis(filters.costStatus || "");
    const templateStatus = normalizeToken(filters.templateStatus || filters.status)
      ? normalizeTemplateStatus(filters.templateStatus || filters.status)
      : "";
    const currency = normalizeToken(filters.currency) ? normalizeCurrency(filters.currency) : "";
    const view = normalizeCostBasis(filters.view || filters.tab || "");

    return asArray(rows).filter((row) => {
      if (productId && !sameToken(row.bokunProductId, productId)) return false;
      if (optionId && !sameToken(row.bokunOptionId, optionId)) return false;
      if (costStatus && row.costStatus !== costStatus) return false;
      if (templateStatus && row.templateStatus !== templateStatus) return false;
      if (currency && normalizeCurrency(row.currency) !== currency) return false;
      if (view === "costed" && row.costStatus !== "costed") return false;
      if (["missing", "missing_cost"].includes(view) && row.costStatus !== "missing_cost") return false;
      if (view === "inactive" && !["inactive", "archived"].includes(row.templateStatus)) return false;
      if (search) {
        const haystack = [
          row.bokunProductId,
          row.bokunProductTitle,
          row.bokunOptionId,
          row.bokunOptionTitle,
          row.templateName,
          row.costBasis,
          row.pricingCategoryTitle
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  };

  const getCostTemplates = async (filters = {}) => {
    const { page, limit, skip } = pagination({ ...filters, limit: filters.limit || DEFAULT_TEMPLATE_LIMIT });
    const [inventory, templates] = await Promise.all([loadCostTemplateInventory(), loadCostTemplates()]);
    const rows = buildCostTemplateRows({ inventory, templates });
    const filteredRows = applyCostTemplateFilters(rows, filters);
    const total = filteredRows.length;
    const pagedRows = filteredRows.slice(skip, skip + limit);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      generatedAt: new Date().toISOString(),
      configured: true,
      sourceOfTruth: {
        productIdentity: "BOKUN_PRODUCT_SNAPSHOT",
        costRules: "RISER_PRODUCT_COST_TEMPLATE"
      },
      summary: {
        totalBokunProducts: inventory.products.length,
        totalBokunOptions: inventory.options.length,
        costedOptions: rows.filter((row) => row.costStatus === "costed").length,
        missingCost: rows.filter((row) => row.costStatus === "missing_cost").length,
        activeTemplates: templates.filter((template) => normalizeTemplateStatus(template.status) === "active").length,
        inactiveTemplates: templates.filter((template) => ["inactive", "archived"].includes(normalizeTemplateStatus(template.status))).length
      },
      products: inventory.products,
      options: inventory.options,
      items: pagedRows,
      templates: templates.map((template) => normalizeTemplateForResponse(template, { includeCostLines: false })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages
      },
      costBasisTypes: COST_BASIS_TYPES,
      templateStatuses: TEMPLATE_STATUSES,
      controlledExpenseCategories: Object.values(EXPENSE_CATEGORY)
    };
  };

  const startCostTemplateBokunProductSync = async ({ auth = {}, requestId = "" } = {}) => {
    const currentCatalog = await getCostTemplates({ page: 1, limit: DEFAULT_TEMPLATE_LIMIT });
    const now = new Date();

    if (productCatalogSyncInFlight) {
      return {
        syncStatus: "already_running",
        syncInProgress: true,
        syncStartedAt: productCatalogSyncStartedAt ? productCatalogSyncStartedAt.toISOString() : null,
        lastResult: lastProductCatalogSyncResult,
        currentCatalog
      };
    }

    productCatalogSyncStartedAt = now;
    const actor = {
      id: auth?.id || null,
      role: auth?.role || "system",
      source: "booking_accounting_cost_templates"
    };

    productCatalogSyncInFlight = Promise.resolve()
      .then(() => ToursService.syncProducts(requestId, actor))
      .then((result) => {
        lastProductCatalogSyncResult = {
          status: "success",
          completedAt: new Date().toISOString(),
          syncedCount: Number(result?.syncedCount || 0),
          syncLogId: result?.syncLogId || null
        };
        logger.info("Cost template Bokun product sync finished", {
          requestId,
          syncedCount: lastProductCatalogSyncResult.syncedCount,
          syncLogId: lastProductCatalogSyncResult.syncLogId
        });
        return result;
      })
      .catch((error) => {
        lastProductCatalogSyncResult = {
          status: "failed",
          completedAt: new Date().toISOString(),
          error: error.message
        };
        logger.warn("Cost template Bokun product sync failed", {
          requestId,
          error: error.message,
          code: error.code,
          statusCode: error.statusCode
        });
        return lastProductCatalogSyncResult;
      })
      .finally(() => {
        productCatalogSyncInFlight = null;
      });

    return {
      syncStatus: "started",
      syncInProgress: true,
      syncStartedAt: productCatalogSyncStartedAt.toISOString(),
      lastResult: lastProductCatalogSyncResult,
      currentCatalog
    };
  };

  const getCostTemplateById = async (templateId) => {
    const template = await findByIdRow(ProductCostTemplateModel, templateId);
    if (!template) throw new AppError("Product cost template was not found.", 404, "COST_TEMPLATE_NOT_FOUND");
    return normalizeTemplateForResponse(template);
  };

  const createCostTemplate = async ({ payload = {}, auth = {}, requestId = "" } = {}) => {
    const templatePayload = await buildTemplatePayload(payload);
    if (templatePayload.status === "active") {
      await assertNoActiveOverlap(templatePayload);
    }
    const actor = { id: auth?.id || "", role: auth?.role || "", email: auth?.email || "" };
    const created = await createRow(ProductCostTemplateModel, {
      ...templatePayload,
      createdBy: actor,
      updatedBy: actor
    });
    await recordCostTemplateAudit({
      action: "product_cost_template_created",
      template: created,
      auth,
      requestId,
      reason: "Product cost template created from Bókun product option.",
      after: normalizeTemplateForResponse(created)
    });
    return {
      action: "created",
      template: normalizeTemplateForResponse(created)
    };
  };

  const updateCostTemplate = async ({ templateId, payload = {}, auth = {}, requestId = "" } = {}) => {
    const existing = await findByIdRow(ProductCostTemplateModel, templateId);
    if (!existing) throw new AppError("Product cost template was not found.", 404, "COST_TEMPLATE_NOT_FOUND");
    const templatePayload = await buildTemplatePayload(payload, { existing });
    if (templatePayload.status === "active") {
      await assertNoActiveOverlap({ ...templatePayload, templateId });
    }
    const updated = await updateByIdRow(ProductCostTemplateModel, templateId, {
      ...templatePayload,
      version: Number(existing.version || 1) + 1,
      updatedBy: { id: auth?.id || "", role: auth?.role || "", email: auth?.email || "" },
      archivedAt: templatePayload.status === "archived" ? new Date() : null
    });
    await recordCostTemplateAudit({
      action: "product_cost_template_updated",
      template: updated,
      auth,
      requestId,
      reason: "Product cost template updated.",
      before: normalizeTemplateForResponse(existing),
      after: normalizeTemplateForResponse(updated)
    });
    return {
      action: "updated",
      template: normalizeTemplateForResponse(updated)
    };
  };

  const archiveCostTemplate = async ({ templateId, auth = {}, requestId = "", reason = "" } = {}) => {
    const existing = await findByIdRow(ProductCostTemplateModel, templateId);
    if (!existing) throw new AppError("Product cost template was not found.", 404, "COST_TEMPLATE_NOT_FOUND");
    const updated = await updateByIdRow(ProductCostTemplateModel, templateId, {
      status: "archived",
      archivedAt: new Date(),
      updatedBy: { id: auth?.id || "", role: auth?.role || "", email: auth?.email || "" }
    });
    await recordCostTemplateAudit({
      action: "product_cost_template_archived",
      template: updated,
      auth,
      requestId,
      reason: reason || "Product cost template archived.",
      before: normalizeTemplateForResponse(existing),
      after: normalizeTemplateForResponse(updated)
    });
    return {
      action: "archived",
      template: normalizeTemplateForResponse(updated)
    };
  };

  const previewCostTemplate = async ({ payload = {} } = {}) => {
    let template = null;
    if (payload.templateId) {
      template = await findByIdRow(ProductCostTemplateModel, payload.templateId);
      if (!template) throw new AppError("Product cost template was not found.", 404, "COST_TEMPLATE_NOT_FOUND");
    }
    const costLines = template ? template.costLines : asArray(payload.costLines).map(normalizeCostLine);
    return calculateEstimatedBookingCost({
      template: template || { currency: payload.currency || "USD", costLines },
      costLines,
      context: payload.context || payload
    });
  };

  const resolveCostTemplate = async ({ booking = {}, asOfDate = new Date(), pricingCategoryId = "" } = {}) => {
    const bokunProductId = normalizeToken(booking.bokunProductId);
    const bokunOptionId = normalizeToken(booking.bokunOptionId);
    if (!bokunProductId || !bokunOptionId) return { template: null, calculation: null };
    const candidates = await findRows(
      ProductCostTemplateModel,
      {
        bokunProductId,
        bokunOptionId,
        status: "active"
      },
      { sort: { validFrom: -1, updatedAt: -1 }, limit: MAX_LIMIT }
    );
    const categoryId = normalizeToken(pricingCategoryId || asArray(booking.priceCategoryParticipants)[0]?.categoryId || "");
    const effective = candidates
      .filter((template) => isTemplateEffective(template, asOfDate))
      .sort((left, right) => {
        const leftSpecific = sameToken(left.pricingCategoryId, categoryId) ? 1 : sameToken(left.pricingCategoryId, "") ? 0 : -1;
        const rightSpecific = sameToken(right.pricingCategoryId, categoryId) ? 1 : sameToken(right.pricingCategoryId, "") ? 0 : -1;
        return rightSpecific - leftSpecific || (toDate(right.validFrom)?.getTime() || 0) - (toDate(left.validFrom)?.getTime() || 0);
      });
    const template = effective[0] || null;
    if (!template) return { template: null, calculation: null };
    const calculation = calculateEstimatedBookingCost({
      template,
      context: {
        adults: booking.paxSummary?.adults,
        children: booking.paxSummary?.children,
        participants: booking.paxSummary?.total,
        vehicles: booking.assignment?.vehicles?.length || booking.vehicles || 0,
        sellingAmount: booking.pricingSnapshot?.finalPayable ?? booking.amount,
        currency: booking.currency
      }
    });
    return {
      template: normalizeTemplateForResponse(template),
      calculation
    };
  };

  return {
    archiveCostTemplate,
    createCostTemplate,
    getCostTemplates,
    getCostTemplateById,
    getDashboard,
    getProfitability,
    getReconciliation,
    listExpenses,
    listInvoices,
    listRefunds,
    previewCostTemplate,
    resolveCostTemplate,
    startCostTemplateBokunProductSync,
    calculateEstimatedBookingCost
  };
};

const service = createBookingAccountingService();

module.exports = {
  ...service,
  createBookingAccountingService,
  __testables: {
    buildReconciliationIssues,
    getRefundConfirmedAmount,
    normalizeExpense,
    normalizeInvoice,
    normalizeRefund,
    roundMoney,
    toNumber
  }
};
