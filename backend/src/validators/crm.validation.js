const { z } = require("zod");
const {
  CRM_ALERT_SEVERITY,
  CRM_ALERT_TYPE,
  CRM_B2B_COMMISSION_MODEL,
  CRM_B2B_NET_RATE_MODEL,
  CRM_B2B_PARTNER_STATUS,
  CRM_B2B_PARTNER_TYPE,
  CRM_COMMUNICATION_CHANNEL,
  CRM_COMMUNICATION_DIRECTION,
  CRM_CONTROL_SEVERITY,
  CRM_DATA_QUALITY_ISSUE,
  CRM_FOLLOW_UP_STATUS,
  CRM_FOLLOW_UP_TYPE,
  CRM_IMPORT_TYPE,
  CRM_LEAD_SOURCE,
  CRM_LEAD_STATUS,
  CRM_LOST_REASON,
  CRM_NOTIFICATION_TYPE,
  CRM_OPPORTUNITY_STAGE,
  CRM_PRIORITY,
  CRM_QUOTE_LINE_ITEM_TYPE,
  CRM_QUOTE_STATUS,
  CRM_REPORT_EXPORT_FORMAT,
  CRM_REPORT_TYPE,
  CRM_TASK_RELATED_ENTITY_TYPE,
  CRM_TASK_STATUS,
  CUSTOMER_DUPLICATE_STATUS,
  CUSTOMER_LIFECYCLE_STAGE,
  CUSTOMER_SEGMENT,
  DUPLICATE_CANDIDATE_STATUS
} = require("../crm/constants");

const mongoObjectId = z.string().regex(/^[a-f\d]{24}$/i, "A valid record ID is required");
const optionalText = (max = 240) => z.string().trim().max(max).optional();
const optionalEmail = z.union([z.string().email(), z.literal("")]).optional();
const optionalDateTime = z.union([z.string().datetime(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional();
const crmReportTypeEnum = z.enum(Object.values(CRM_REPORT_TYPE));
const crmReportExportFormatEnum = z.enum(Object.values(CRM_REPORT_EXPORT_FORMAT));
const crmControlSeverityEnum = z.enum(Object.values(CRM_CONTROL_SEVERITY));
const crmDataQualityIssueEnum = z.enum(Object.values(CRM_DATA_QUALITY_ISSUE));
const crmImportTypeEnum = z.enum(Object.values(CRM_IMPORT_TYPE));

const externalReferenceSchema = z.object({
  provider: z.string().trim().min(1).max(80),
  reference: z.string().trim().min(1).max(180),
  rawReference: z.string().trim().max(180).optional(),
  metadata: z.record(z.any()).optional()
});

const customerBodySchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  email: z.string().email(),
  phone: optionalText(80),
  whatsappNumber: optionalText(80),
  whatsapp: optionalText(80),
  country: optionalText(80),
  hotelName: optionalText(160),
  pickupPlaceId: optionalText(160),
  notes: optionalText(2000),
  lifecycleStage: z.enum(Object.values(CUSTOMER_LIFECYCLE_STAGE)).optional(),
  segments: z.array(z.enum(Object.values(CUSTOMER_SEGMENT))).max(30).optional(),
  manualSegments: z.array(z.enum(Object.values(CUSTOMER_SEGMENT))).max(30).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  source: z.enum(Object.values(CRM_LEAD_SOURCE)).optional(),
  sourceDetails: optionalText(240),
  preferredContactChannel: z.enum(["EMAIL", "PHONE", "WHATSAPP", ""]).optional(),
  externalReferences: z.array(externalReferenceSchema).max(30).optional(),
  dataQuality: z
    .object({
      reviewedAt: z.string().datetime().optional(),
      reviewNote: optionalText(500)
    })
    .optional()
});

const assignedToSchema = z
  .object({
    id: z.string().trim().max(120).optional(),
    role: z.string().trim().max(80).optional(),
    email: optionalEmail,
    name: z.string().trim().max(160).optional()
  })
  .optional();

const followUpBodySchema = z.object({
  leadId: mongoObjectId.optional(),
  opportunityId: mongoObjectId.optional(),
  customerId: mongoObjectId.optional(),
  type: z.enum(Object.values(CRM_FOLLOW_UP_TYPE)).optional(),
  dueAt: z.string().datetime(),
  status: z.enum(Object.values(CRM_FOLLOW_UP_STATUS)).optional(),
  assignedTo: assignedToSchema,
  priority: z.enum(Object.values(CRM_PRIORITY)).optional(),
  notes: optionalText(2000),
  completedAt: optionalDateTime,
  outcome: optionalText(2000)
});

const updateFollowUpBodySchema = followUpBodySchema.partial();

const taskBodySchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: optionalText(3000),
  relatedEntityType: z.enum(Object.values(CRM_TASK_RELATED_ENTITY_TYPE)).optional(),
  relatedEntityId: z.string().trim().max(180).optional(),
  assignedTo: assignedToSchema,
  dueDate: optionalDateTime,
  priority: z.enum(Object.values(CRM_PRIORITY)).optional(),
  status: z.enum(Object.values(CRM_TASK_STATUS)).optional(),
  completedAt: optionalDateTime,
  outcome: optionalText(2000)
});

const updateTaskBodySchema = taskBodySchema.partial();

const b2bPartnerBodySchema = z.object({
  partnerNumber: z.string().trim().max(60).optional(),
  partnerType: z.enum(Object.values(CRM_B2B_PARTNER_TYPE)).optional(),
  companyName: z.string().trim().min(1).max(180),
  contactPerson: z.string().trim().min(1).max(180),
  email: optionalEmail,
  phone: optionalText(80),
  country: optionalText(80),
  commissionModel: z.enum(Object.values(CRM_B2B_COMMISSION_MODEL)).optional(),
  commissionRate: z.coerce.number().min(0).max(100).optional(),
  fixedCommissionAmount: z.coerce.number().min(0).max(999999999).optional(),
  netRateModel: z.enum(Object.values(CRM_B2B_NET_RATE_MODEL)).optional(),
  creditLimit: z.coerce.number().min(0).max(999999999).optional(),
  currency: z.string().trim().length(3).optional(),
  paymentTerms: optionalText(500),
  assignedManager: assignedToSchema,
  status: z.enum(Object.values(CRM_B2B_PARTNER_STATUS)).optional(),
  linkedAgentId: mongoObjectId.optional(),
  notes: optionalText(2000),
  externalReferences: z.array(externalReferenceSchema).max(30).optional(),
  rawPayload: z.record(z.any()).optional()
});

const updateB2BPartnerBodySchema = b2bPartnerBodySchema.partial();

const leadProductSchema = z.object({
  productId: z.string().trim().max(120).optional(),
  productTitle: z.string().trim().max(180).optional(),
  optionId: z.string().trim().max(120).optional(),
  optionTitle: z.string().trim().max(180).optional()
});

const leadTravelIntentSchema = z
  .object({
    travelDate: z.string().trim().max(30).optional(),
    startTime: z.string().trim().max(30).optional(),
    adults: z.coerce.number().int().min(0).max(999).optional(),
    children: z.coerce.number().int().min(0).max(999).optional(),
    totalParticipants: z.coerce.number().int().min(0).max(999).optional(),
    budgetAmount: z.union([z.coerce.number().min(0), z.null()]).optional(),
    budgetCurrency: z.string().trim().length(3).optional()
  })
  .optional();

const opportunityProductSchema = leadProductSchema;

const opportunityBodySchema = z.object({
  leadId: mongoObjectId.optional(),
  customerId: mongoObjectId.optional(),
  title: optionalText(180),
  stage: z.enum(Object.values(CRM_OPPORTUNITY_STAGE)).optional(),
  estimatedValue: z.coerce.number().min(0).max(999999999).optional(),
  currency: z.string().trim().length(3).optional(),
  probability: z.coerce.number().min(0).max(100).optional(),
  expectedCloseDate: optionalDateTime,
  interestedProducts: z.array(opportunityProductSchema).max(20).optional(),
  assignedTo: assignedToSchema,
  source: z.enum(Object.values(CRM_LEAD_SOURCE)).optional(),
  notes: optionalText(2000),
  lostReason: z.enum(Object.values(CRM_LOST_REASON)).optional(),
  lostReasonNote: optionalText(1000),
  wonBookingId: mongoObjectId.optional(),
  wonBokunBookingId: optionalText(180),
  externalReferences: z.array(externalReferenceSchema).max(30).optional(),
  rawPayload: z.record(z.any()).optional()
});

const quoteLineItemSchema = z.object({
  itemType: z.enum(Object.values(CRM_QUOTE_LINE_ITEM_TYPE)).optional(),
  description: z.string().trim().min(1).max(500),
  productId: z.string().trim().max(120).optional(),
  productOptionId: z.string().trim().max(120).optional(),
  quantity: z.coerce.number().min(0.000001).max(999999).optional(),
  unitPrice: z.coerce.number().min(0).max(999999999).optional(),
  discount: z.coerce.number().min(0).max(999999999).optional(),
  tax: z.coerce.number().min(0).max(999999999).optional(),
  lineTotal: z.coerce.number().min(0).max(999999999).optional()
});

const quoteBodySchema = z.object({
  quoteNumber: z.string().trim().max(60).optional(),
  leadId: mongoObjectId.optional(),
  opportunityId: mongoObjectId.optional(),
  customerId: mongoObjectId.optional(),
  currency: z.string().trim().length(3).optional(),
  issueDate: optionalDateTime,
  validUntil: optionalDateTime,
  lineItems: z.array(quoteLineItemSchema).min(1).max(80),
  status: z.enum(Object.values(CRM_QUOTE_STATUS)).optional(),
  notes: optionalText(3000),
  terms: optionalText(3000)
});

const updateQuoteBodySchema = quoteBodySchema
  .partial()
  .extend({
    lineItems: z.array(quoteLineItemSchema).min(1).max(80).optional()
  });

const quoteConversionBodySchema = z
  .object({
    bookingId: mongoObjectId.optional(),
    bookingReference: optionalText(120),
    bokunBookingId: optionalText(180),
    conversionNote: optionalText(1000)
  })
  .refine((value) => Boolean(value.bookingId || value.bookingReference || value.bokunBookingId), {
    message: "A booking ID, booking reference, or Bokun booking ID is required.",
    path: ["bookingReference"]
  });

const leadBodySchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  email: optionalEmail,
  phone: optionalText(80),
  whatsappNumber: optionalText(80),
  whatsapp: optionalText(80),
  source: z.enum(Object.values(CRM_LEAD_SOURCE)).optional(),
  sourceDetails: optionalText(240),
  status: z.enum(Object.values(CRM_LEAD_STATUS)).optional(),
  assignedTo: assignedToSchema,
  interestedProducts: z.array(leadProductSchema).max(20).optional(),
  travelIntent: leadTravelIntentSchema,
  customerId: mongoObjectId.optional(),
  lostReason: optionalText(1000),
  unqualifiedReason: optionalText(1000),
  lastContactedAt: optionalDateTime,
  nextFollowUpAt: optionalDateTime,
  notes: optionalText(2000),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  externalReferences: z.array(externalReferenceSchema).max(30).optional(),
  rawPayload: z.record(z.any()).optional()
});

const updateLeadBodySchema = leadBodySchema.partial();
const updateOpportunityBodySchema = opportunityBodySchema.partial();

const updateCustomerBodySchema = customerBodySchema.partial().extend({
  email: optionalEmail
});

const listCustomersSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      search: z.string().trim().max(160).optional(),
      lifecycleStage: z.enum(Object.values(CUSTOMER_LIFECYCLE_STAGE)).optional(),
      segment: z.enum(Object.values(CUSTOMER_SEGMENT)).optional(),
      tag: z.string().trim().max(80).optional(),
      duplicateStatus: z.enum(Object.values(CUSTOMER_DUPLICATE_STATUS)).optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional()
    })
    .optional()
});

const createCustomerSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: customerBodySchema
});

const updateCustomerSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: updateCustomerBodySchema
});

const customerCommunicationBodySchema = z.object({
  channel: z.enum(Object.values(CRM_COMMUNICATION_CHANNEL)).optional(),
  direction: z.enum(Object.values(CRM_COMMUNICATION_DIRECTION)).optional(),
  subject: optionalText(240),
  summary: z.string().trim().min(1).max(500),
  note: optionalText(2000),
  occurredAt: optionalDateTime,
  relatedEntityType: optionalText(80),
  relatedEntityId: optionalText(180),
  reference: optionalText(180),
  sensitive: z.coerce.boolean().optional(),
  metadata: z.record(z.any()).optional()
});

const logCustomerCommunicationSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: customerCommunicationBodySchema
});

const customerIdParamsSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z
    .object({
      limit: z.coerce.number().int().min(1).max(300).optional()
    })
    .optional(),
  body: z.object({}).optional()
});

const listDuplicateCandidatesSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      status: z.enum(Object.values(DUPLICATE_CANDIDATE_STATUS)).optional(),
      limit: z.coerce.number().int().min(1).max(300).optional()
    })
    .optional()
});

const listLeadsSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      search: z.string().trim().max(160).optional(),
      status: z.enum(Object.values(CRM_LEAD_STATUS)).optional(),
      source: z.enum(Object.values(CRM_LEAD_SOURCE)).optional(),
      assignedTo: z.string().trim().max(120).optional(),
      tag: z.string().trim().max(80).optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional()
    })
    .optional()
});

const listOpportunitiesSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      search: z.string().trim().max(160).optional(),
      stage: z.enum(Object.values(CRM_OPPORTUNITY_STAGE)).optional(),
      source: z.enum(Object.values(CRM_LEAD_SOURCE)).optional(),
      assignedTo: z.string().trim().max(120).optional(),
      leadId: mongoObjectId.optional(),
      customerId: mongoObjectId.optional(),
      openOnly: z.coerce.boolean().optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional()
    })
    .optional()
});

const listQuotesSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      search: z.string().trim().max(160).optional(),
      status: z.enum(Object.values(CRM_QUOTE_STATUS)).optional(),
      leadId: mongoObjectId.optional(),
      opportunityId: mongoObjectId.optional(),
      customerId: mongoObjectId.optional(),
      currency: z.string().trim().length(3).optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional()
    })
    .optional()
});

const listFollowUpsSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      search: z.string().trim().max(160).optional(),
      status: z.enum(Object.values(CRM_FOLLOW_UP_STATUS)).optional(),
      type: z.enum(Object.values(CRM_FOLLOW_UP_TYPE)).optional(),
      priority: z.enum(Object.values(CRM_PRIORITY)).optional(),
      assignedTo: z.string().trim().max(120).optional(),
      leadId: mongoObjectId.optional(),
      opportunityId: mongoObjectId.optional(),
      customerId: mongoObjectId.optional(),
      dueBefore: optionalDateTime,
      dueAfter: optionalDateTime,
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional()
    })
    .optional()
});

const listTasksSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      search: z.string().trim().max(160).optional(),
      status: z.enum(Object.values(CRM_TASK_STATUS)).optional(),
      priority: z.enum(Object.values(CRM_PRIORITY)).optional(),
      assignedTo: z.string().trim().max(120).optional(),
      relatedEntityType: z.enum(Object.values(CRM_TASK_RELATED_ENTITY_TYPE)).optional(),
      relatedEntityId: z.string().trim().max(180).optional(),
      dueBefore: optionalDateTime,
      dueAfter: optionalDateTime,
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional()
    })
    .optional()
});

const listB2BPartnersSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      search: z.string().trim().max(160).optional(),
      status: z.enum(Object.values(CRM_B2B_PARTNER_STATUS)).optional(),
      partnerType: z.enum(Object.values(CRM_B2B_PARTNER_TYPE)).optional(),
      assignedManager: z.string().trim().max(120).optional(),
      country: z.string().trim().max(80).optional(),
      openOnly: z.coerce.boolean().optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional()
    })
    .optional()
});

const salesPipelineSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      includeClosed: z.coerce.boolean().optional(),
      limitPerStage: z.coerce.number().int().min(1).max(50).optional(),
      source: z.enum(Object.values(CRM_LEAD_SOURCE)).optional(),
      assignedTo: z.string().trim().max(120).optional(),
      currency: z.string().trim().length(3).optional()
    })
    .optional()
});

const crmAnalyticsSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      from: optionalDateTime,
      to: optionalDateTime,
      source: z.enum(Object.values(CRM_LEAD_SOURCE)).optional(),
      assignedTo: z.string().trim().max(120).optional(),
      currency: z.string().trim().length(3).optional()
    })
    .optional()
});

const crmAlertsSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      type: z.enum(Object.values(CRM_ALERT_TYPE)).optional(),
      severity: z.enum(Object.values(CRM_ALERT_SEVERITY)).optional(),
      notificationType: z.enum(Object.values(CRM_NOTIFICATION_TYPE)).optional(),
      assignedTo: z.string().trim().max(120).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional()
    })
    .optional()
});

const crmControlsSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z
    .object({
      severity: crmControlSeverityEnum.optional(),
      code: crmDataQualityIssueEnum.optional(),
      entityType: z
        .enum([
          "B2BPartner",
          "Customer",
          "CustomerDuplicateCandidate",
          "FollowUp",
          "Lead",
          "Quote",
          "SalesOpportunity"
        ])
        .optional(),
      reference: z.string().trim().max(180).optional(),
      issueLimit: z.coerce.number().int().min(1).max(500).optional(),
      sourceLimit: z.coerce.number().int().min(50).max(5000).optional()
    })
    .optional()
});

const crmImportSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({
    importType: crmImportTypeEnum,
    dryRun: z.coerce.boolean().optional(),
    source: optionalText(120),
    evidenceNote: optionalText(1000),
    records: z.array(z.record(z.any())).min(1).max(500)
  })
});

const crmReportFilterShape = {
  from: optionalDateTime,
  to: optionalDateTime,
  source: z.enum(Object.values(CRM_LEAD_SOURCE)).optional(),
  assignedTo: z.string().trim().max(120).optional(),
  currency: z.string().trim().length(3).optional()
};

const crmReportCatalogSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z.object({}).optional()
});

const crmRunReportSchema = z.object({
  params: z.object({
    reportType: crmReportTypeEnum
  }),
  body: z.object({}).optional(),
  query: z.object(crmReportFilterShape).optional()
});

const crmExportReportSchema = z.object({
  params: z.object({
    reportType: crmReportTypeEnum
  }),
  body: z.object({}).optional(),
  query: z
    .object({
      ...crmReportFilterShape,
      format: crmReportExportFormatEnum.optional()
    })
    .optional()
});

const createLeadSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: leadBodySchema
});

const createOpportunitySchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: opportunityBodySchema
});

const createQuoteSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: quoteBodySchema
});

const createFollowUpSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: followUpBodySchema
});

const createTaskSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: taskBodySchema
});

const createB2BPartnerSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: b2bPartnerBodySchema
});

const updateLeadSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: updateLeadBodySchema
});

const updateOpportunitySchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: updateOpportunityBodySchema
});

const updateQuoteSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: updateQuoteBodySchema
});

const updateFollowUpSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: updateFollowUpBodySchema
});

const updateTaskSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: updateTaskBodySchema
});

const updateB2BPartnerSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: updateB2BPartnerBodySchema
});

const leadIdParamsSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: z.object({}).optional()
});

const quoteIdParamsSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: z.object({}).default({})
});

const convertQuoteToBookingSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: quoteConversionBodySchema
});

const followUpActionSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: z
    .object({
      outcome: optionalText(2000)
    })
    .default({})
});

const taskActionSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: z
    .object({
      outcome: optionalText(2000)
    })
    .default({})
});

const opportunityIdParamsSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: z.object({}).optional()
});

const b2bPartnerIdParamsSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: z.object({}).optional()
});

const convertLeadToCustomerSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: z
    .object({
      customerId: mongoObjectId.optional(),
      conversionNote: optionalText(1000)
    })
    .default({})
});

const convertLeadToOpportunitySchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: opportunityBodySchema.omit({ leadId: true }).partial().default({})
});

const reviewDuplicateCandidateSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  query: z.object({}).optional(),
  body: z.object({
    status: z.enum([
      DUPLICATE_CANDIDATE_STATUS.REVIEWED,
      DUPLICATE_CANDIDATE_STATUS.DISMISSED
    ]),
    reviewNote: z.string().trim().min(3).max(1000)
  })
});

const dashboardSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({}).optional(),
  query: z.object({}).optional()
});

module.exports = {
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
  opportunityIdParamsSchema,
  quoteIdParamsSchema,
  reviewDuplicateCandidateSchema,
  salesPipelineSchema,
  taskActionSchema,
  updateB2BPartnerSchema,
  updateCustomerSchema,
  updateFollowUpSchema,
  updateLeadSchema,
  updateOpportunitySchema,
  updateQuoteSchema,
  updateTaskSchema
};
