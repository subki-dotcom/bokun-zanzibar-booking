const Lead = require("../../models/Lead");
const SalesOpportunity = require("../../models/SalesOpportunity");
const Quote = require("../../models/Quote");
const FollowUp = require("../../models/FollowUp");
const CrmTask = require("../../models/CrmTask");
const B2BPartner = require("../../models/B2BPartner");
const {
  CRM_B2B_PARTNER_STATUS,
  CRM_LEAD_SOURCE,
  CRM_LEAD_STATUS,
  CRM_OPPORTUNITY_STAGE,
  CRM_QUOTE_STATUS,
  CRM_TASK_STATUS,
  CRM_FOLLOW_UP_STATUS
} = require("../../crm/constants");

const OPEN_OPPORTUNITY_STAGES = Object.freeze(
  Object.values(CRM_OPPORTUNITY_STAGE).filter((stage) => ![CRM_OPPORTUNITY_STAGE.WON, CRM_OPPORTUNITY_STAGE.LOST].includes(stage))
);
const OPEN_B2B_STATUSES = Object.freeze([
  CRM_B2B_PARTNER_STATUS.PROSPECT,
  CRM_B2B_PARTNER_STATUS.CONTACTED,
  CRM_B2B_PARTNER_STATUS.PROPOSAL_SENT,
  CRM_B2B_PARTNER_STATUS.NEGOTIATION,
  CRM_B2B_PARTNER_STATUS.AGREEMENT
]);
const OPEN_TASK_STATUSES = Object.freeze([CRM_TASK_STATUS.TODO, CRM_TASK_STATUS.IN_PROGRESS]);
const QUOTE_RESPONSE_STATUSES = Object.freeze([
  CRM_QUOTE_STATUS.SENT,
  CRM_QUOTE_STATUS.VIEWED,
  CRM_QUOTE_STATUS.ACCEPTED,
  CRM_QUOTE_STATUS.CONVERTED,
  CRM_QUOTE_STATUS.REJECTED,
  CRM_QUOTE_STATUS.EXPIRED
]);
const QUOTE_ACCEPTED_STATUSES = Object.freeze([CRM_QUOTE_STATUS.ACCEPTED, CRM_QUOTE_STATUS.CONVERTED]);

const toPlain = (value) => {
  if (!value) return value;
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};
const asArray = (value) => (Array.isArray(value) ? value : []);
const normalizeToken = (value = "") => String(value || "").trim();
const normalizeCurrency = (value = "") => normalizeToken(value).toUpperCase().slice(0, 3);
const idOf = (value) => String(value?._id || value?.id || value || "");
const toMoney = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(number, 0) : 0;
};
const roundMoney = (value) => Number(toMoney(value).toFixed(2));
const pct = (part = 0, whole = 0) => {
  const denominator = Number(whole || 0);
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return Number(((Number(part || 0) / denominator) * 100).toFixed(2));
};
const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const endExclusive = (value) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + 1);
    return date;
  }
  return parseDate(value);
};
const buildCreatedAtQuery = ({ from = "", to = "" } = {}) => {
  const createdAt = {};
  const start = parseDate(from);
  const end = endExclusive(to);
  if (start) createdAt.$gte = start;
  if (end) createdAt.$lt = end;
  return Object.keys(createdAt).length ? { createdAt } : {};
};
const buildDueQuery = ({ from = "", to = "" } = {}) => {
  const due = {};
  const start = parseDate(from);
  const end = endExclusive(to);
  if (start) due.$gte = start;
  if (end) due.$lt = end;
  return due;
};
const executeFind = async (query, { sort, select } = {}) => {
  let next = query;
  if (next && select && typeof next.select === "function") next = next.select(select);
  if (next && sort && typeof next.sort === "function") next = next.sort(sort);
  if (next && typeof next.lean === "function") next = next.lean();
  const rows = next && typeof next.then === "function" ? await next : next;
  return asArray(rows).map(toPlain);
};
const countBy = (rows = [], keyFn = () => "") => {
  const counts = new Map();
  rows.forEach((row) => {
    const key = normalizeToken(keyFn(row)) || "UNKNOWN";
    const current = counts.get(key) || { _id: key, count: 0 };
    current.count += 1;
    counts.set(key, current);
  });
  return [...counts.values()].sort((left, right) => right.count - left.count || String(left._id).localeCompare(String(right._id)));
};
const orderBreakdown = (breakdown = [], order = []) => {
  const byKey = new Map(breakdown.map((row) => [row._id, row]));
  const ordered = order.filter((key) => byKey.has(key)).map((key) => byKey.get(key));
  const extras = breakdown.filter((row) => !order.includes(row._id));
  return [...ordered, ...extras];
};
const sum = (rows = [], mapper = () => 0) =>
  rows.reduce((total, row) => total + toMoney(mapper(row)), 0);
const weightedValue = (opportunity = {}) =>
  roundMoney(toMoney(opportunity.estimatedValue) * Math.min(Math.max(Number(opportunity.probability || 0), 0), 100) / 100);
const isOpenOpportunity = (opportunity = {}) => OPEN_OPPORTUNITY_STAGES.includes(opportunity.stage);
const hasWonBookingEvidence = (opportunity = {}) =>
  Boolean(idOf(opportunity.wonBookingId) || normalizeToken(opportunity.wonBokunBookingId));
const hasConvertedQuoteEvidence = (quote = {}) =>
  Boolean(idOf(quote.convertedBookingId) || normalizeToken(quote.bokunBookingId));
const uniqueBookingEvidenceCount = ({ opportunities = [], quotes = [] } = {}) => {
  const keys = new Set();
  opportunities.forEach((opportunity) => {
    if (opportunity.stage !== CRM_OPPORTUNITY_STAGE.WON) return;
    const key = normalizeToken(opportunity.wonBokunBookingId) || idOf(opportunity.wonBookingId);
    if (key) keys.add(key);
  });
  quotes.forEach((quote) => {
    const key = normalizeToken(quote.bokunBookingId) || idOf(quote.convertedBookingId);
    if (key) keys.add(key);
  });
  return keys.size;
};
const normalizeFilters = (filters = {}) => {
  const source = normalizeToken(filters.source).toUpperCase();
  const currency = normalizeCurrency(filters.currency);
  return {
    from: normalizeToken(filters.from),
    to: normalizeToken(filters.to),
    source: Object.values(CRM_LEAD_SOURCE).includes(source) ? source : "",
    currency,
    assignedTo: normalizeToken(filters.assignedTo)
  };
};
const buildLeadQuery = (filters = {}) => ({
  ...buildCreatedAtQuery(filters),
  ...(filters.source ? { source: filters.source } : {}),
  ...(filters.assignedTo ? { "assignedTo.id": filters.assignedTo } : {})
});
const buildOpportunityQuery = (filters = {}) => ({
  ...buildCreatedAtQuery(filters),
  ...(filters.source ? { source: filters.source } : {}),
  ...(filters.currency ? { currency: filters.currency } : {}),
  ...(filters.assignedTo ? { "assignedTo.id": filters.assignedTo } : {})
});
const buildQuoteQuery = (filters = {}) => ({
  ...buildCreatedAtQuery(filters),
  ...(filters.currency ? { currency: filters.currency } : {})
});
const buildActivityQuery = (filters = {}, dateField = "createdAt") => ({
  ...(dateField === "createdAt" ? buildCreatedAtQuery(filters) : { [dateField]: buildDueQuery(filters) }),
  ...(filters.assignedTo ? { "assignedTo.id": filters.assignedTo } : {})
});
const buildB2BQuery = (filters = {}) => ({
  ...buildCreatedAtQuery(filters),
  ...(filters.assignedTo ? { "assignedManager.id": filters.assignedTo } : {})
});
const filterQuotesBySource = (quotes = [], { source = "", leads = [], opportunities = [] } = {}) => {
  if (!source) return quotes;
  const leadIds = new Set(leads.map(idOf).filter(Boolean));
  const opportunityIds = new Set(opportunities.map(idOf).filter(Boolean));
  return quotes.filter((quote) => leadIds.has(idOf(quote.leadId)) || opportunityIds.has(idOf(quote.opportunityId)));
};
const rollupPipeline = (opportunities = []) => {
  const open = opportunities.filter(isOpenOpportunity);
  const byStage = orderBreakdown(
    Object.values(CRM_OPPORTUNITY_STAGE).map((stage) => {
      const rows = opportunities.filter((opportunity) => opportunity.stage === stage);
      return {
        _id: stage,
        count: rows.length,
        totalEstimatedValue: roundMoney(sum(rows, (row) => row.estimatedValue)),
        weightedValue: roundMoney(rows.reduce((total, row) => total + weightedValue(row), 0))
      };
    }).filter((row) => row.count > 0),
    Object.values(CRM_OPPORTUNITY_STAGE)
  );
  return {
    openCount: open.length,
    wonCount: opportunities.filter((row) => row.stage === CRM_OPPORTUNITY_STAGE.WON).length,
    lostCount: opportunities.filter((row) => row.stage === CRM_OPPORTUNITY_STAGE.LOST).length,
    openPipelineValue: roundMoney(sum(open, (row) => row.estimatedValue)),
    weightedPipelineValue: roundMoney(open.reduce((total, row) => total + weightedValue(row), 0)),
    byStage,
    bySource: countBy(opportunities, (row) => row.source).map((row) => ({
      ...row,
      totalEstimatedValue: roundMoney(sum(opportunities.filter((item) => (item.source || "UNKNOWN") === row._id), (item) => item.estimatedValue))
    })),
    byCurrency: countBy(opportunities, (row) => row.currency).map((row) => ({
      ...row,
      openPipelineValue: roundMoney(sum(open.filter((item) => (item.currency || "UNKNOWN") === row._id), (item) => item.estimatedValue)),
      weightedPipelineValue: roundMoney(open.filter((item) => (item.currency || "UNKNOWN") === row._id).reduce((total, item) => total + weightedValue(item), 0))
    }))
  };
};
const rollupQuotes = (quotes = []) => {
  const responded = quotes.filter((quote) => QUOTE_RESPONSE_STATUSES.includes(quote.status));
  const accepted = quotes.filter((quote) => QUOTE_ACCEPTED_STATUSES.includes(quote.status));
  return {
    count: quotes.length,
    sentOrViewedCount: quotes.filter((quote) => [CRM_QUOTE_STATUS.SENT, CRM_QUOTE_STATUS.VIEWED].includes(quote.status)).length,
    acceptedCount: accepted.length,
    convertedCount: quotes.filter((quote) => quote.status === CRM_QUOTE_STATUS.CONVERTED || hasConvertedQuoteEvidence(quote)).length,
    totalQuotedValue: roundMoney(sum(quotes, (row) => row.total)),
    acceptedQuoteValue: roundMoney(sum(accepted, (row) => row.total)),
    quoteAcceptanceRate: pct(accepted.length, responded.length),
    byStatus: orderBreakdown(countBy(quotes, (row) => row.status), Object.values(CRM_QUOTE_STATUS)),
    byCurrency: countBy(quotes, (row) => row.currency).map((row) => ({
      ...row,
      totalQuotedValue: roundMoney(sum(quotes.filter((item) => (item.currency || "UNKNOWN") === row._id), (item) => item.total))
    }))
  };
};
const rollupLost = (opportunities = []) => {
  const lost = opportunities.filter((opportunity) => opportunity.stage === CRM_OPPORTUNITY_STAGE.LOST);
  return {
    count: lost.length,
    totalEstimatedValue: roundMoney(sum(lost, (row) => row.estimatedValue)),
    byReason: countBy(lost, (row) => row.lostReason || "OTHER").map((row) => ({
      ...row,
      totalEstimatedValue: roundMoney(sum(lost.filter((item) => (item.lostReason || "OTHER") === row._id), (item) => item.estimatedValue))
    })),
    crmLostValueIsNotAccountingLoss: true
  };
};
const productKey = ({ productId = "", productTitle = "", optionId = "", productOptionId = "", description = "" } = {}) =>
  [normalizeToken(productId), normalizeToken(optionId || productOptionId), normalizeToken(productTitle || description)].join("|");
const ensureProduct = (map, data = {}) => {
  const key = productKey(data);
  if (!map.has(key)) {
    map.set(key, {
      productId: normalizeToken(data.productId),
      productTitle: normalizeToken(data.productTitle || data.description || "Unknown product"),
      optionId: normalizeToken(data.optionId || data.productOptionId),
      optionTitle: normalizeToken(data.optionTitle),
      leadInterestCount: 0,
      opportunityCount: 0,
      quoteLineItemCount: 0,
      estimatedPipelineValue: 0,
      weightedPipelineValue: 0,
      quotedValue: 0
    });
  }
  return map.get(key);
};
const buildProductInterest = ({ leads = [], opportunities = [], quotes = [] } = {}) => {
  const products = new Map();
  leads.forEach((lead) => {
    asArray(lead.interestedProducts).forEach((product) => {
      const row = ensureProduct(products, product);
      row.leadInterestCount += 1;
    });
  });
  opportunities.forEach((opportunity) => {
    asArray(opportunity.interestedProducts).forEach((product) => {
      const row = ensureProduct(products, product);
      row.opportunityCount += 1;
      row.estimatedPipelineValue += toMoney(opportunity.estimatedValue);
      row.weightedPipelineValue += weightedValue(opportunity);
    });
  });
  quotes.forEach((quote) => {
    asArray(quote.lineItems).forEach((item) => {
      const row = ensureProduct(products, {
        productId: item.productId,
        productOptionId: item.productOptionId,
        description: item.description
      });
      row.quoteLineItemCount += 1;
      row.quotedValue += toMoney(item.lineTotal);
    });
  });
  return [...products.values()]
    .map((row) => ({
      ...row,
      estimatedPipelineValue: roundMoney(row.estimatedPipelineValue),
      weightedPipelineValue: roundMoney(row.weightedPipelineValue),
      quotedValue: roundMoney(row.quotedValue),
      totalSignals: row.leadInterestCount + row.opportunityCount + row.quoteLineItemCount
    }))
    .filter((row) => row.totalSignals > 0)
    .sort((left, right) =>
      right.totalSignals - left.totalSignals ||
      right.weightedPipelineValue - left.weightedPipelineValue ||
      right.quotedValue - left.quotedValue
    )
    .slice(0, 20);
};
const rollupActivities = ({ followUps = [], tasks = [], now = new Date() } = {}) => {
  const current = parseDate(now) || new Date();
  const pendingFollowUps = followUps.filter((item) => item.status === CRM_FOLLOW_UP_STATUS.PENDING);
  const openTasks = tasks.filter((item) => OPEN_TASK_STATUSES.includes(item.status));
  const overdueFollowUps = pendingFollowUps.filter((item) => parseDate(item.dueAt) && parseDate(item.dueAt) <= current);
  const overdueTasks = openTasks.filter((item) => parseDate(item.dueDate) && parseDate(item.dueDate) <= current);
  return {
    followUpCount: followUps.length,
    pendingFollowUpCount: pendingFollowUps.length,
    overdueFollowUpCount: overdueFollowUps.length,
    taskCount: tasks.length,
    openTaskCount: openTasks.length,
    overdueTaskCount: overdueTasks.length,
    overdueWorkCount: overdueFollowUps.length + overdueTasks.length,
    byFollowUpStatus: orderBreakdown(countBy(followUps, (row) => row.status), Object.values(CRM_FOLLOW_UP_STATUS)),
    byTaskStatus: orderBreakdown(countBy(tasks, (row) => row.status), Object.values(CRM_TASK_STATUS))
  };
};
const rollupB2B = (partners = []) => ({
  partnerCount: partners.length,
  activePartnerCount: partners.filter((partner) => partner.status === CRM_B2B_PARTNER_STATUS.ACTIVE_PARTNER).length,
  openPartnerCount: partners.filter((partner) => OPEN_B2B_STATUSES.includes(partner.status)).length,
  byStatus: orderBreakdown(countBy(partners, (row) => row.status), Object.values(CRM_B2B_PARTNER_STATUS)),
  byType: countBy(partners, (row) => row.partnerType),
  accountingPostsLedgerEntries: false
});

const createCrmAnalyticsService = ({
  LeadModel = Lead,
  SalesOpportunityModel = SalesOpportunity,
  QuoteModel = Quote,
  FollowUpModel = FollowUp,
  CrmTaskModel = CrmTask,
  B2BPartnerModel = B2BPartner,
  now = () => new Date()
} = {}) => {
  const getCrmAnalytics = async (filters = {}) => {
    const normalizedFilters = normalizeFilters(filters);
    const [leads, opportunities, rawQuotes, followUps, tasks, b2bPartners] = await Promise.all([
      executeFind(LeadModel.find(buildLeadQuery(normalizedFilters)), { sort: { createdAt: -1 } }),
      executeFind(SalesOpportunityModel.find(buildOpportunityQuery(normalizedFilters)), { sort: { createdAt: -1 } }),
      executeFind(QuoteModel.find(buildQuoteQuery(normalizedFilters)), { sort: { createdAt: -1 } }),
      executeFind(FollowUpModel.find(buildActivityQuery(normalizedFilters, "createdAt")), { sort: { dueAt: 1 } }),
      executeFind(CrmTaskModel.find(buildActivityQuery(normalizedFilters, "createdAt")), { sort: { dueDate: 1 } }),
      executeFind(B2BPartnerModel.find(buildB2BQuery(normalizedFilters)), { sort: { updatedAt: -1 } })
    ]);
    const quotes = filterQuotesBySource(rawQuotes, { source: normalizedFilters.source, leads, opportunities });
    const pipeline = rollupPipeline(opportunities);
    const quoteAnalytics = rollupQuotes(quotes);
    const lost = rollupLost(opportunities);
    const activities = rollupActivities({ followUps, tasks, now: now() });
    const b2b = rollupB2B(b2bPartners);
    const qualifiedLeadCount = leads.filter((lead) =>
      [CRM_LEAD_STATUS.QUALIFIED, CRM_LEAD_STATUS.CONVERTED].includes(lead.status)
    ).length;
    const convertedLeadCount = leads.filter((lead) => lead.status === CRM_LEAD_STATUS.CONVERTED).length;
    const wonBookingEvidenceCount = uniqueBookingEvidenceCount({ opportunities, quotes });

    return {
      step: "7J",
      module: "CRM_ANALYTICS",
      generatedAt: now().toISOString(),
      filters: normalizedFilters,
      sourceOfTruth: {
        crmSource: "CRM records own leads, opportunities, quotes, follow-ups, tasks and B2B pipeline.",
        operationalBookingSource: "Bokun confirmed bookings remain operational truth after CRM conversion.",
        actualRevenueSource: "Booking Accounting after Bokun confirmed booking",
        pipelineValueIsForecastOnly: true,
        quoteValueIsForecastOnly: true,
        crmLostValueIsNotAccountingLoss: true
      },
      totals: {
        leadCount: leads.length,
        qualifiedLeadCount,
        convertedLeadCount,
        leadQualificationRate: pct(qualifiedLeadCount, leads.length),
        leadConversionRate: pct(convertedLeadCount, leads.length),
        opportunityCount: opportunities.length,
        openOpportunityCount: pipeline.openCount,
        wonOpportunityCount: pipeline.wonCount,
        lostOpportunityCount: pipeline.lostCount,
        opportunityWinRate: pct(pipeline.wonCount, pipeline.wonCount + pipeline.lostCount),
        openPipelineValue: pipeline.openPipelineValue,
        weightedPipelineValue: pipeline.weightedPipelineValue,
        quoteCount: quoteAnalytics.count,
        quoteAcceptanceRate: quoteAnalytics.quoteAcceptanceRate,
        totalQuotedValue: quoteAnalytics.totalQuotedValue,
        acceptedQuoteValue: quoteAnalytics.acceptedQuoteValue,
        wonBookingEvidenceCount,
        b2bPartnerCount: b2b.partnerCount,
        activeB2BPartnerCount: b2b.activePartnerCount,
        overdueWorkCount: activities.overdueWorkCount
      },
      funnel: [
        { key: "LEADS", label: "Leads", count: leads.length, basis: "CRM lead records" },
        { key: "QUALIFIED_LEADS", label: "Qualified leads", count: qualifiedLeadCount, rateFromPrevious: pct(qualifiedLeadCount, leads.length), basis: "Qualified or converted lead records" },
        { key: "OPEN_OPPORTUNITIES", label: "Open opportunities", count: pipeline.openCount, value: pipeline.openPipelineValue, weightedValue: pipeline.weightedPipelineValue, rateFromPrevious: pct(pipeline.openCount, qualifiedLeadCount), basis: "Open CRM opportunity forecast" },
        { key: "QUOTES_RESPONDED", label: "Sent or viewed quotes", count: quoteAnalytics.sentOrViewedCount, value: quoteAnalytics.totalQuotedValue, rateFromPrevious: pct(quoteAnalytics.sentOrViewedCount, pipeline.openCount), basis: "Quote records; value is forecast only" },
        { key: "ACCEPTED_QUOTES", label: "Accepted quotes", count: quoteAnalytics.acceptedCount, value: quoteAnalytics.acceptedQuoteValue, rateFromPrevious: quoteAnalytics.quoteAcceptanceRate, basis: "Accepted or converted quote records" },
        { key: "BOKUN_BOOKING_EVIDENCE", label: "Linked confirmed bookings", count: wonBookingEvidenceCount, rateFromPrevious: pct(wonBookingEvidenceCount, quoteAnalytics.acceptedCount), basis: "CRM records with confirmed Bokun/local booking evidence" }
      ],
      leads: {
        byStatus: orderBreakdown(countBy(leads, (row) => row.status), Object.values(CRM_LEAD_STATUS)),
        bySource: orderBreakdown(countBy(leads, (row) => row.source), Object.values(CRM_LEAD_SOURCE))
      },
      pipeline,
      quotes: quoteAnalytics,
      lost,
      activities,
      b2b,
      productInterest: buildProductInterest({ leads, opportunities, quotes }),
      limitations: [
        "CRM pipeline and quote values are forecasts until a Bokun-confirmed booking enters local accounting.",
        "Actual revenue, refunds, profit and margin must come from Booking Accounting and Business Intelligence services.",
        ...(normalizedFilters.source ? ["Quote source attribution is derived from linked CRM leads or opportunities only."] : [])
      ]
    };
  };

  return {
    getCrmAnalytics
  };
};

const service = createCrmAnalyticsService();

module.exports = {
  ...service,
  createCrmAnalyticsService,
  __testables: {
    buildProductInterest,
    normalizeFilters,
    rollupPipeline,
    rollupQuotes,
    rollupLost
  }
};
