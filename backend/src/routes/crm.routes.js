const express = require("express");
const crmController = require("../controllers/crm.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const validateRequest = require("../middleware/validateRequest");
const { PERMISSIONS } = require("../security/permissions");
const {
  b2bPartnerIdParamsSchema,
  convertLeadToCustomerSchema,
  convertLeadToOpportunitySchema,
  convertQuoteToBookingSchema,
  createB2BPartnerSchema,
  createCustomerSchema,
  createFollowUpSchema,
  createLeadSchema,
  createOpportunitySchema,
  createQuoteSchema,
  createTaskSchema,
  crmAlertsSchema,
  crmAnalyticsSchema,
  crmControlsSchema,
  crmImportSchema,
  crmExportReportSchema,
  crmReportCatalogSchema,
  crmRunReportSchema,
  customerIdParamsSchema,
  dashboardSchema,
  followUpActionSchema,
  leadIdParamsSchema,
  listCustomersSchema,
  listB2BPartnersSchema,
  listDuplicateCandidatesSchema,
  listFollowUpsSchema,
  listLeadsSchema,
  listOpportunitiesSchema,
  listQuotesSchema,
  listTasksSchema,
  logCustomerCommunicationSchema,
  salesPipelineSchema,
  opportunityIdParamsSchema,
  quoteIdParamsSchema,
  reviewDuplicateCandidateSchema,
  taskActionSchema,
  updateB2BPartnerSchema,
  updateCustomerSchema,
  updateFollowUpSchema,
  updateLeadSchema,
  updateOpportunitySchema,
  updateQuoteSchema,
  updateTaskSchema
} = require("../validators/crm.validation");

const router = express.Router();

router.use(authenticate);

router.get(
  "/dashboard",
  authorizePermission(PERMISSIONS.CRM_VIEW),
  validateRequest(dashboardSchema),
  crmController.dashboard
);

router.get(
  "/analytics",
  authorizePermission(PERMISSIONS.CRM_VIEW_SALES_ANALYTICS),
  validateRequest(crmAnalyticsSchema),
  crmController.analytics
);

router.get(
  "/alerts",
  authorizePermission(PERMISSIONS.CRM_VIEW),
  validateRequest(crmAlertsSchema),
  crmController.alerts
);

router.get(
  "/controls",
  authorizePermission(PERMISSIONS.CRM_VIEW_SALES_ANALYTICS),
  validateRequest(crmControlsSchema),
  crmController.controls
);

router.post(
  "/imports",
  authorizePermission(PERMISSIONS.CRM_MANAGE_CUSTOMERS, PERMISSIONS.CRM_MANAGE_LEADS, PERMISSIONS.CRM_MANAGE_B2B),
  validateRequest(crmImportSchema),
  crmController.runImport
);

router.get(
  "/reports/catalog",
  authorizePermission(PERMISSIONS.CRM_VIEW_SALES_ANALYTICS),
  validateRequest(crmReportCatalogSchema),
  crmController.reportCatalog
);

router.get(
  "/reports/:reportType/export",
  authorizePermission(PERMISSIONS.CRM_VIEW_SALES_ANALYTICS),
  validateRequest(crmExportReportSchema),
  crmController.exportReport
);

router.get(
  "/reports/:reportType",
  authorizePermission(PERMISSIONS.CRM_VIEW_SALES_ANALYTICS),
  validateRequest(crmRunReportSchema),
  crmController.runReport
);

router.get(
  "/leads",
  authorizePermission(PERMISSIONS.CRM_MANAGE_LEADS),
  validateRequest(listLeadsSchema),
  crmController.listLeads
);

router.post(
  "/leads",
  authorizePermission(PERMISSIONS.CRM_MANAGE_LEADS),
  validateRequest(createLeadSchema),
  crmController.createLead
);

router.get(
  "/leads/:id",
  authorizePermission(PERMISSIONS.CRM_MANAGE_LEADS),
  validateRequest(leadIdParamsSchema),
  crmController.getLead
);

router.patch(
  "/leads/:id",
  authorizePermission(PERMISSIONS.CRM_MANAGE_LEADS),
  validateRequest(updateLeadSchema),
  crmController.updateLead
);

router.post(
  "/leads/:id/convert-to-customer",
  authorizePermission(PERMISSIONS.CRM_MANAGE_LEADS, PERMISSIONS.CRM_MANAGE_CUSTOMERS),
  validateRequest(convertLeadToCustomerSchema),
  crmController.convertLeadToCustomer
);

router.post(
  "/leads/:id/convert-to-opportunity",
  authorizePermission(PERMISSIONS.CRM_MANAGE_LEADS, PERMISSIONS.CRM_MANAGE_OPPORTUNITIES),
  validateRequest(convertLeadToOpportunitySchema),
  crmController.convertLeadToOpportunity
);

router.get(
  "/quotes",
  authorizePermission(PERMISSIONS.CRM_MANAGE_QUOTES),
  validateRequest(listQuotesSchema),
  crmController.listQuotes
);

router.post(
  "/quotes",
  authorizePermission(PERMISSIONS.CRM_MANAGE_QUOTES),
  validateRequest(createQuoteSchema),
  crmController.createQuote
);

router.get(
  "/quotes/:id",
  authorizePermission(PERMISSIONS.CRM_MANAGE_QUOTES),
  validateRequest(quoteIdParamsSchema),
  crmController.getQuote
);

router.patch(
  "/quotes/:id",
  authorizePermission(PERMISSIONS.CRM_MANAGE_QUOTES),
  validateRequest(updateQuoteSchema),
  crmController.updateQuote
);

router.post(
  "/quotes/:id/approve",
  authorizePermission(PERMISSIONS.CRM_APPROVE_QUOTES),
  validateRequest(quoteIdParamsSchema),
  crmController.approveQuote
);

router.post(
  "/quotes/:id/send",
  authorizePermission(PERMISSIONS.CRM_MANAGE_QUOTES),
  validateRequest(quoteIdParamsSchema),
  crmController.sendQuote
);

router.post(
  "/quotes/:id/accept",
  authorizePermission(PERMISSIONS.CRM_MANAGE_QUOTES),
  validateRequest(quoteIdParamsSchema),
  crmController.acceptQuote
);

router.post(
  "/quotes/:id/convert",
  authorizePermission(PERMISSIONS.CRM_MANAGE_QUOTES, PERMISSIONS.CRM_MANAGE_OPPORTUNITIES),
  validateRequest(convertQuoteToBookingSchema),
  crmController.convertQuoteToBooking
);

router.get(
  "/follow-ups",
  authorizePermission(PERMISSIONS.CRM_MANAGE_FOLLOWUPS),
  validateRequest(listFollowUpsSchema),
  crmController.listFollowUps
);

router.post(
  "/follow-ups",
  authorizePermission(PERMISSIONS.CRM_MANAGE_FOLLOWUPS),
  validateRequest(createFollowUpSchema),
  crmController.createFollowUp
);

router.patch(
  "/follow-ups/:id",
  authorizePermission(PERMISSIONS.CRM_MANAGE_FOLLOWUPS),
  validateRequest(updateFollowUpSchema),
  crmController.updateFollowUp
);

router.post(
  "/follow-ups/:id/complete",
  authorizePermission(PERMISSIONS.CRM_MANAGE_FOLLOWUPS),
  validateRequest(followUpActionSchema),
  crmController.completeFollowUp
);

router.get(
  "/tasks",
  authorizePermission(PERMISSIONS.CRM_MANAGE_FOLLOWUPS),
  validateRequest(listTasksSchema),
  crmController.listTasks
);

router.post(
  "/tasks",
  authorizePermission(PERMISSIONS.CRM_MANAGE_FOLLOWUPS),
  validateRequest(createTaskSchema),
  crmController.createTask
);

router.patch(
  "/tasks/:id",
  authorizePermission(PERMISSIONS.CRM_MANAGE_FOLLOWUPS),
  validateRequest(updateTaskSchema),
  crmController.updateTask
);

router.post(
  "/tasks/:id/complete",
  authorizePermission(PERMISSIONS.CRM_MANAGE_FOLLOWUPS),
  validateRequest(taskActionSchema),
  crmController.completeTask
);

router.get(
  "/opportunities",
  authorizePermission(PERMISSIONS.CRM_MANAGE_OPPORTUNITIES),
  validateRequest(listOpportunitiesSchema),
  crmController.listOpportunities
);

router.post(
  "/opportunities",
  authorizePermission(PERMISSIONS.CRM_MANAGE_OPPORTUNITIES),
  validateRequest(createOpportunitySchema),
  crmController.createOpportunity
);

router.get(
  "/opportunities/:id",
  authorizePermission(PERMISSIONS.CRM_MANAGE_OPPORTUNITIES),
  validateRequest(opportunityIdParamsSchema),
  crmController.getOpportunity
);

router.patch(
  "/opportunities/:id",
  authorizePermission(PERMISSIONS.CRM_MANAGE_OPPORTUNITIES),
  validateRequest(updateOpportunitySchema),
  crmController.updateOpportunity
);

router.get(
  "/pipeline",
  authorizePermission(PERMISSIONS.CRM_MANAGE_OPPORTUNITIES),
  validateRequest(salesPipelineSchema),
  crmController.salesPipeline
);

router.get(
  "/b2b-agents",
  authorizePermission(PERMISSIONS.CRM_MANAGE_B2B),
  validateRequest(listB2BPartnersSchema),
  crmController.listB2BPartners
);

router.post(
  "/b2b-agents",
  authorizePermission(PERMISSIONS.CRM_MANAGE_B2B),
  validateRequest(createB2BPartnerSchema),
  crmController.createB2BPartner
);

router.get(
  "/b2b-agents/:id",
  authorizePermission(PERMISSIONS.CRM_MANAGE_B2B),
  validateRequest(b2bPartnerIdParamsSchema),
  crmController.getB2BPartner
);

router.patch(
  "/b2b-agents/:id",
  authorizePermission(PERMISSIONS.CRM_MANAGE_B2B),
  validateRequest(updateB2BPartnerSchema),
  crmController.updateB2BPartner
);

router.get(
  "/customers",
  authorizePermission(PERMISSIONS.CRM_VIEW_CUSTOMERS),
  validateRequest(listCustomersSchema),
  crmController.listCustomers
);

router.post(
  "/customers",
  authorizePermission(PERMISSIONS.CRM_MANAGE_CUSTOMERS),
  validateRequest(createCustomerSchema),
  crmController.createCustomer
);

router.get(
  "/customers/:id",
  authorizePermission(PERMISSIONS.CRM_VIEW_CUSTOMERS),
  validateRequest(customerIdParamsSchema),
  crmController.getCustomer
);

router.patch(
  "/customers/:id",
  authorizePermission(PERMISSIONS.CRM_MANAGE_CUSTOMERS),
  validateRequest(updateCustomerSchema),
  crmController.updateCustomer
);

router.get(
  "/customers/:id/timeline",
  authorizePermission(PERMISSIONS.CRM_VIEW_CUSTOMERS),
  validateRequest(customerIdParamsSchema),
  crmController.listCustomerTimeline
);

router.post(
  "/customers/:id/communications",
  authorizePermission(PERMISSIONS.CRM_MANAGE_CUSTOMERS),
  validateRequest(logCustomerCommunicationSchema),
  crmController.logCustomerCommunication
);

router.get(
  "/duplicates",
  authorizePermission(PERMISSIONS.CRM_MANAGE_CUSTOMERS),
  validateRequest(listDuplicateCandidatesSchema),
  crmController.listDuplicateCandidates
);

router.post(
  "/duplicates/:id/review",
  authorizePermission(PERMISSIONS.CRM_MANAGE_CUSTOMERS),
  validateRequest(reviewDuplicateCandidateSchema),
  crmController.reviewDuplicateCandidate
);

module.exports = router;
