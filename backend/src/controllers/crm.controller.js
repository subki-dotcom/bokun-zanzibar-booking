const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const customersService = require("../services/customers");
const crmLeadsService = require("../services/crmLeads");
const crmOpportunitiesService = require("../services/crmOpportunities");
const crmQuotesService = require("../services/crmQuotes");
const crmFollowUpsService = require("../services/crmFollowUps");
const crmB2BPartnersService = require("../services/crmB2BPartners");
const { hasPermission, PERMISSIONS } = require("../security/permissions");

const dashboard = asyncHandler(async (_req, res) => {
  const [customerFoundation, leadMetrics, opportunityMetrics, quoteMetrics, followUpMetrics, b2bMetrics] = await Promise.all([
    customersService.getCrmDashboard(),
    crmLeadsService.getLeadDashboardMetrics(),
    crmOpportunitiesService.getOpportunityDashboardMetrics(),
    crmQuotesService.getQuoteDashboardMetrics(),
    crmFollowUpsService.getFollowUpDashboardMetrics(),
    crmB2BPartnersService.getB2BPartnerMetrics()
  ]);
  const data = {
    ...customerFoundation,
    metrics: {
      ...(customerFoundation.metrics || {}),
      ...leadMetrics,
      ...opportunityMetrics,
      ...quoteMetrics,
      ...followUpMetrics,
      ...b2bMetrics
    },
    enabledModules: [
      ...new Set([
        ...(customerFoundation.enabledModules || []),
        "LEADS",
        "OPPORTUNITIES",
        "QUOTES",
        "FOLLOW_UPS",
        "TASKS",
        "B2B_PARTNERS"
      ])
    ],
    plannedModules: (customerFoundation.plannedModules || []).filter(
      (moduleName) => !["LEADS", "OPPORTUNITIES", "QUOTES", "FOLLOW_UPS", "TASKS", "B2B_PARTNERS"].includes(moduleName)
    )
  };
  return successResponse(res, {
    message: "CRM dashboard fetched",
    data
  });
});

const listCustomers = asyncHandler(async (req, res) => {
  const data = await customersService.listCustomers({
    ...(req.validated?.query || {}),
    withMeta: true
  });
  return successResponse(res, {
    message: "CRM customers fetched",
    data
  });
});

const createCustomer = asyncHandler(async (req, res) => {
  const data = await customersService.createCustomer({
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: data.action === "existing" ? "Existing customer matched" : "CRM customer created",
    data,
    statusCode: data.action === "created" ? 201 : 200
  });
});

const getCustomer = asyncHandler(async (req, res) => {
  const data = await customersService.getCustomerProfile(req.validated.params.id, {
    includeFinancials: hasPermission(req.auth, PERMISSIONS.CRM_VIEW_CUSTOMER_FINANCIALS)
  });
  return successResponse(res, {
    message: "CRM customer profile fetched",
    data
  });
});

const updateCustomer = asyncHandler(async (req, res) => {
  const data = await customersService.updateCustomer({
    customerId: req.validated.params.id,
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM customer updated",
    data
  });
});

const listCustomerTimeline = asyncHandler(async (req, res) => {
  const data = await customersService.listCustomerTimeline({
    customerId: req.validated.params.id,
    limit: req.validated.query?.limit
  });
  return successResponse(res, {
    message: "CRM customer timeline fetched",
    data
  });
});

const logCustomerCommunication = asyncHandler(async (req, res) => {
  const data = await customersService.logCustomerCommunication({
    customerId: req.validated.params.id,
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM customer communication logged",
    data,
    statusCode: 201
  });
});

const listDuplicateCandidates = asyncHandler(async (req, res) => {
  const data = await customersService.listDuplicateCandidates(req.validated?.query || {});
  return successResponse(res, {
    message: "CRM duplicate candidates fetched",
    data
  });
});

const reviewDuplicateCandidate = asyncHandler(async (req, res) => {
  const data = await customersService.reviewDuplicateCandidate({
    candidateId: req.validated.params.id,
    status: req.validated.body.status,
    reviewNote: req.validated.body.reviewNote,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM duplicate candidate reviewed",
    data
  });
});

const listLeads = asyncHandler(async (req, res) => {
  const data = await crmLeadsService.listLeads({
    ...(req.validated?.query || {}),
    withMeta: true
  });
  return successResponse(res, {
    message: "CRM leads fetched",
    data
  });
});

const createLead = asyncHandler(async (req, res) => {
  const data = await crmLeadsService.createLead({
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: data.action === "existing" ? "Existing lead matched" : "CRM lead created",
    data,
    statusCode: data.action === "created" ? 201 : 200
  });
});

const getLead = asyncHandler(async (req, res) => {
  const data = await crmLeadsService.getLead(req.validated.params.id);
  return successResponse(res, {
    message: "CRM lead fetched",
    data
  });
});

const updateLead = asyncHandler(async (req, res) => {
  const data = await crmLeadsService.updateLead({
    leadId: req.validated.params.id,
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM lead updated",
    data
  });
});

const convertLeadToCustomer = asyncHandler(async (req, res) => {
  const data = await crmLeadsService.convertLeadToCustomer({
    leadId: req.validated.params.id,
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM lead converted to customer",
    data
  });
});

const listOpportunities = asyncHandler(async (req, res) => {
  const data = await crmOpportunitiesService.listOpportunities({
    ...(req.validated?.query || {}),
    withMeta: true
  });
  return successResponse(res, {
    message: "CRM opportunities fetched",
    data
  });
});

const createOpportunity = asyncHandler(async (req, res) => {
  const data = await crmOpportunitiesService.createOpportunity({
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: data.action === "existing" ? "Existing opportunity matched" : "CRM opportunity created",
    data,
    statusCode: data.action === "created" ? 201 : 200
  });
});

const getOpportunity = asyncHandler(async (req, res) => {
  const data = await crmOpportunitiesService.getOpportunity(req.validated.params.id);
  return successResponse(res, {
    message: "CRM opportunity fetched",
    data
  });
});

const updateOpportunity = asyncHandler(async (req, res) => {
  const data = await crmOpportunitiesService.updateOpportunity({
    opportunityId: req.validated.params.id,
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM opportunity updated",
    data
  });
});

const convertLeadToOpportunity = asyncHandler(async (req, res) => {
  const data = await crmOpportunitiesService.convertLeadToOpportunity({
    leadId: req.validated.params.id,
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM lead converted to opportunity",
    data,
    statusCode: data.action === "created" ? 201 : 200
  });
});

const salesPipeline = asyncHandler(async (req, res) => {
  const data = await crmOpportunitiesService.getSalesPipeline(req.validated?.query || {});
  return successResponse(res, {
    message: "CRM sales pipeline fetched",
    data
  });
});

const listQuotes = asyncHandler(async (req, res) => {
  const data = await crmQuotesService.listQuotes({
    ...(req.validated?.query || {}),
    withMeta: true
  });
  return successResponse(res, {
    message: "CRM quotes fetched",
    data
  });
});

const createQuote = asyncHandler(async (req, res) => {
  const data = await crmQuotesService.createQuote({
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM quote created",
    data,
    statusCode: 201
  });
});

const getQuote = asyncHandler(async (req, res) => {
  const data = await crmQuotesService.getQuote(req.validated.params.id);
  return successResponse(res, {
    message: "CRM quote fetched",
    data
  });
});

const updateQuote = asyncHandler(async (req, res) => {
  const data = await crmQuotesService.updateQuote({
    quoteId: req.validated.params.id,
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM quote updated",
    data
  });
});

const approveQuote = asyncHandler(async (req, res) => {
  const data = await crmQuotesService.approveQuote({
    quoteId: req.validated.params.id,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM quote approved",
    data
  });
});

const sendQuote = asyncHandler(async (req, res) => {
  const data = await crmQuotesService.sendQuote({
    quoteId: req.validated.params.id,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM quote sent",
    data
  });
});

const acceptQuote = asyncHandler(async (req, res) => {
  const data = await crmQuotesService.acceptQuote({
    quoteId: req.validated.params.id,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM quote accepted",
    data
  });
});

const convertQuoteToBooking = asyncHandler(async (req, res) => {
  const data = await crmQuotesService.convertQuoteToBooking({
    quoteId: req.validated.params.id,
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: data.action === "existing" ? "CRM quote already converted" : "CRM quote converted to confirmed booking",
    data
  });
});

const listFollowUps = asyncHandler(async (req, res) => {
  const data = await crmFollowUpsService.listFollowUps({
    ...(req.validated?.query || {}),
    withMeta: true
  });
  return successResponse(res, {
    message: "CRM follow-ups fetched",
    data
  });
});

const createFollowUp = asyncHandler(async (req, res) => {
  const data = await crmFollowUpsService.createFollowUp({
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM follow-up created",
    data,
    statusCode: 201
  });
});

const updateFollowUp = asyncHandler(async (req, res) => {
  const data = await crmFollowUpsService.updateFollowUp({
    followUpId: req.validated.params.id,
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM follow-up updated",
    data
  });
});

const completeFollowUp = asyncHandler(async (req, res) => {
  const data = await crmFollowUpsService.completeFollowUp({
    followUpId: req.validated.params.id,
    outcome: req.validated.body?.outcome,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM follow-up completed",
    data
  });
});

const listTasks = asyncHandler(async (req, res) => {
  const data = await crmFollowUpsService.listTasks({
    ...(req.validated?.query || {}),
    withMeta: true
  });
  return successResponse(res, {
    message: "CRM tasks fetched",
    data
  });
});

const createTask = asyncHandler(async (req, res) => {
  const data = await crmFollowUpsService.createTask({
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM task created",
    data,
    statusCode: 201
  });
});

const updateTask = asyncHandler(async (req, res) => {
  const data = await crmFollowUpsService.updateTask({
    taskId: req.validated.params.id,
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM task updated",
    data
  });
});

const completeTask = asyncHandler(async (req, res) => {
  const data = await crmFollowUpsService.completeTask({
    taskId: req.validated.params.id,
    outcome: req.validated.body?.outcome,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM task completed",
    data
  });
});

const listB2BPartners = asyncHandler(async (req, res) => {
  const data = await crmB2BPartnersService.listB2BPartners({
    ...(req.validated?.query || {}),
    withMeta: true
  });
  return successResponse(res, {
    message: "CRM B2B partners fetched",
    data
  });
});

const createB2BPartner = asyncHandler(async (req, res) => {
  const data = await crmB2BPartnersService.createB2BPartner({
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: data.action === "existing" ? "Existing B2B partner matched" : "CRM B2B partner created",
    data,
    statusCode: data.action === "created" ? 201 : 200
  });
});

const getB2BPartner = asyncHandler(async (req, res) => {
  const data = await crmB2BPartnersService.getB2BPartner(req.validated.params.id);
  return successResponse(res, {
    message: "CRM B2B partner fetched",
    data
  });
});

const updateB2BPartner = asyncHandler(async (req, res) => {
  const data = await crmB2BPartnersService.updateB2BPartner({
    partnerId: req.validated.params.id,
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "CRM B2B partner updated",
    data
  });
});

module.exports = {
  acceptQuote,
  approveQuote,
  completeFollowUp,
  completeTask,
  createB2BPartner,
  convertLeadToOpportunity,
  convertLeadToCustomer,
  convertQuoteToBooking,
  createCustomer,
  createFollowUp,
  createLead,
  createOpportunity,
  createQuote,
  createTask,
  dashboard,
  getB2BPartner,
  getCustomer,
  getLead,
  getOpportunity,
  getQuote,
  listB2BPartners,
  listCustomerTimeline,
  listCustomers,
  listDuplicateCandidates,
  logCustomerCommunication,
  listFollowUps,
  listLeads,
  listOpportunities,
  listQuotes,
  listTasks,
  reviewDuplicateCandidate,
  salesPipeline,
  sendQuote,
  updateB2BPartner,
  updateCustomer,
  updateFollowUp,
  updateLead,
  updateOpportunity,
  updateQuote,
  updateTask
};
