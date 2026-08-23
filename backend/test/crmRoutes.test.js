process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/crm-route-test";
process.env.JWT_SECRET ||= "crm-route-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const User = require("../src/models/User");
const customersService = require("../src/services/customers");
const crmLeadsService = require("../src/services/crmLeads");
const crmOpportunitiesService = require("../src/services/crmOpportunities");
const crmQuotesService = require("../src/services/crmQuotes");
const crmFollowUpsService = require("../src/services/crmFollowUps");
const crmB2BPartnersService = require("../src/services/crmB2BPartners");

const adminId = "66eeeeeeeeeeeeeeeeeeeeee";

const adminToken = () =>
  jwt.sign(
    {
      sub: adminId,
      userType: "user"
    },
    process.env.JWT_SECRET,
    { expiresIn: "5m" }
  );

const withMockAdmin = (role = "admin") => {
  const originalFindById = User.findById;
  User.findById = () => ({
    lean: async () => ({
      _id: { toString: () => adminId },
      role,
      isActive: true,
      email: `${role}@example.test`
    })
  });
  return () => {
    User.findById = originalFindById;
  };
};

const listen = async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
};

const close = (server) =>
  new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

test("CRM dashboard route requires auth and returns Step 7A foundation summary", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalDashboard = customersService.getCrmDashboard;
  const originalLeadMetrics = crmLeadsService.getLeadDashboardMetrics;
  const originalOpportunityMetrics = crmOpportunitiesService.getOpportunityDashboardMetrics;
  const originalQuoteMetrics = crmQuotesService.getQuoteDashboardMetrics;
  const originalFollowUpMetrics = crmFollowUpsService.getFollowUpDashboardMetrics;
  const originalB2BMetrics = crmB2BPartnersService.getB2BPartnerMetrics;
  customersService.getCrmDashboard = async () => ({
    step: "7A",
    foundationReady: true,
    metrics: { customerCount: 1, possibleDuplicateCount: 0, openDuplicateCount: 0 }
  });
  crmLeadsService.getLeadDashboardMetrics = async () => ({
    leadCount: 0,
    newLeadCount: 0,
    qualifiedLeadCount: 0,
    convertedLeadCount: 0,
    lostLeadCount: 0,
    statusBreakdown: [],
    sourceBreakdown: []
  });
  crmOpportunitiesService.getOpportunityDashboardMetrics = async () => ({
    opportunityCount: 0,
    openOpportunityCount: 0,
    wonOpportunityCount: 0,
    lostOpportunityCount: 0,
    openPipelineValue: 0,
    weightedPipelineValue: 0,
    pipelineByCurrency: [],
    opportunityStageBreakdown: []
  });
  crmQuotesService.getQuoteDashboardMetrics = async () => ({
    quoteCount: 0,
    draftQuoteCount: 0,
    sentQuoteCount: 0,
    acceptedQuoteCount: 0,
    rejectedQuoteCount: 0,
    totalQuotedValue: 0,
    sentQuoteValue: 0,
    acceptedQuoteValue: 0,
    quoteStatusBreakdown: [],
    quoteValueIsForecastOnly: true
  });
  crmFollowUpsService.getFollowUpDashboardMetrics = async () => ({
    followUpCount: 0,
    pendingFollowUpCount: 0,
    followUpsDueCount: 0,
    overdueFollowUpCount: 0,
    missedFollowUpCount: 0,
    taskCount: 0,
    openTaskCount: 0,
    tasksDueCount: 0,
    overdueTaskCount: 0
  });
  crmB2BPartnersService.getB2BPartnerMetrics = async () => ({
    b2bPartnerCount: 0,
    activeB2BPartnerCount: 0,
    openB2BPartnerCount: 0,
    b2bStatusBreakdown: [],
    b2bTypeBreakdown: [],
    b2bAccountingPostsLedgerEntries: false
  });
  const server = await listen();

  try {
    const { port } = server.address();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/crm/dashboard`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/dashboard`, {
      headers: { Authorization: `Bearer ${adminToken()}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.step, "7A");
    assert.equal(payload.data.foundationReady, true);
  } finally {
    customersService.getCrmDashboard = originalDashboard;
    crmLeadsService.getLeadDashboardMetrics = originalLeadMetrics;
    crmOpportunitiesService.getOpportunityDashboardMetrics = originalOpportunityMetrics;
    crmQuotesService.getQuoteDashboardMetrics = originalQuoteMetrics;
    crmFollowUpsService.getFollowUpDashboardMetrics = originalFollowUpMetrics;
    crmB2BPartnersService.getB2BPartnerMetrics = originalB2BMetrics;
    restoreUser();
    await close(server);
  }
});

test("staff without CRM permissions cannot access CRM customer route", async () => {
  const restoreUser = withMockAdmin("staff");
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customers`, {
      headers: { Authorization: `Bearer ${adminToken()}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error.code, "FORBIDDEN_PERMISSION");
  } finally {
    restoreUser();
    await close(server);
  }
});

test("CRM customer create route validates payload before service writes", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalCreate = customersService.createCustomer;
  let called = false;
  customersService.createCustomer = async () => {
    called = true;
    return { action: "created", customer: { id: "customer-1" } };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        firstName: "Name",
        lastName: "Only"
      })
    });

    assert.equal(response.status, 422);
    assert.equal(called, false);
  } finally {
    customersService.createCustomer = originalCreate;
    restoreUser();
    await close(server);
  }
});

test("CRM customer communication route validates channel before service writes", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalLogCommunication = customersService.logCustomerCommunication;
  let called = false;
  customersService.logCustomerCommunication = async () => {
    called = true;
    return { action: "logged", event: { id: "timeline-1" } };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customers/66eeeeeeeeeeeeeeeeeeeeee/communications`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        channel: "MADE_UP_CHANNEL",
        summary: "Customer replied."
      })
    });

    assert.equal(response.status, 422);
    assert.equal(called, false);
  } finally {
    customersService.logCustomerCommunication = originalLogCommunication;
    restoreUser();
    await close(server);
  }
});

test("CRM customer communication route logs manual communication through service", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalLogCommunication = customersService.logCustomerCommunication;
  let received = null;
  customersService.logCustomerCommunication = async (payload) => {
    received = payload;
    return {
      action: "logged",
      deliveryStatusIsProviderVerified: false,
      event: {
        id: "timeline-1",
        eventType: "COMMUNICATION_LOGGED",
        summary: payload.payload.summary,
        communication: {
          channel: payload.payload.channel,
          direction: payload.payload.direction,
          status: "MANUAL_LOGGED"
        }
      }
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customers/66eeeeeeeeeeeeeeeeeeeeee/communications`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        channel: "WHATSAPP",
        direction: "OUTBOUND",
        summary: "WhatsApp follow-up logged.",
        note: "Customer confirmed pickup."
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.success, true);
    assert.equal(payload.data.event.communication.channel, "WHATSAPP");
    assert.equal(payload.data.deliveryStatusIsProviderVerified, false);
    assert.equal(received.customerId, "66eeeeeeeeeeeeeeeeeeeeee");
    assert.equal(received.payload.note, "Customer confirmed pickup.");
  } finally {
    customersService.logCustomerCommunication = originalLogCommunication;
    restoreUser();
    await close(server);
  }
});

test("CRM leads route requires auth and returns lead pipeline data", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalListLeads = crmLeadsService.listLeads;
  crmLeadsService.listLeads = async () => ({
    items: [
      {
        id: "lead-1",
        leadReference: "LED-1",
        fullName: "Asha Traveler",
        status: "NEW",
        source: "WEBSITE"
      }
    ],
    count: 1,
    page: 1,
    limit: 50
  });
  const server = await listen();

  try {
    const { port } = server.address();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/crm/leads`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/leads?status=NEW`, {
      headers: { Authorization: `Bearer ${adminToken()}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].leadReference, "LED-1");
  } finally {
    crmLeadsService.listLeads = originalListLeads;
    restoreUser();
    await close(server);
  }
});

test("CRM lead create route validates source enum before service writes", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalCreateLead = crmLeadsService.createLead;
  let called = false;
  crmLeadsService.createLead = async () => {
    called = true;
    return { action: "created", lead: { id: "lead-1" } };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/leads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        firstName: "Asha",
        lastName: "Traveler",
        email: "asha@example.com",
        source: "MADE_UP_SOURCE"
      })
    });

    assert.equal(response.status, 422);
    assert.equal(called, false);
  } finally {
    crmLeadsService.createLead = originalCreateLead;
    restoreUser();
    await close(server);
  }
});

test("CRM opportunities route requires auth and returns pipeline data", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalListOpportunities = crmOpportunitiesService.listOpportunities;
  crmOpportunitiesService.listOpportunities = async () => ({
    items: [
      {
        id: "opp-1",
        opportunityNumber: "OPP-1",
        title: "Asha safari",
        stage: "QUALIFIED",
        estimatedValue: 100,
        probability: 25,
        weightedValue: 25
      }
    ],
    count: 1,
    page: 1,
    limit: 50
  });
  const server = await listen();

  try {
    const { port } = server.address();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/crm/opportunities`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/opportunities?stage=QUALIFIED`, {
      headers: { Authorization: `Bearer ${adminToken()}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].opportunityNumber, "OPP-1");
  } finally {
    crmOpportunitiesService.listOpportunities = originalListOpportunities;
    restoreUser();
    await close(server);
  }
});

test("CRM opportunity create route validates stage enum before service writes", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalCreateOpportunity = crmOpportunitiesService.createOpportunity;
  let called = false;
  crmOpportunitiesService.createOpportunity = async () => {
    called = true;
    return { action: "created", opportunity: { id: "opp-1" } };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/opportunities`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        title: "Asha safari",
        stage: "MADE_UP_STAGE"
      })
    });

    assert.equal(response.status, 422);
    assert.equal(called, false);
  } finally {
    crmOpportunitiesService.createOpportunity = originalCreateOpportunity;
    restoreUser();
    await close(server);
  }
});

test("CRM quotes route requires auth and returns quote register data", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalListQuotes = crmQuotesService.listQuotes;
  crmQuotesService.listQuotes = async () => ({
    items: [
      {
        id: "quote-1",
        quoteNumber: "QTE-1",
        status: "DRAFT",
        total: 100,
        currency: "USD",
        quoteValueIsForecastOnly: true
      }
    ],
    count: 1,
    page: 1,
    limit: 50
  });
  const server = await listen();

  try {
    const { port } = server.address();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/crm/quotes`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/quotes?status=DRAFT`, {
      headers: { Authorization: `Bearer ${adminToken()}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].quoteNumber, "QTE-1");
    assert.equal(payload.data.items[0].quoteValueIsForecastOnly, true);
  } finally {
    crmQuotesService.listQuotes = originalListQuotes;
    restoreUser();
    await close(server);
  }
});

test("CRM quote create route validates status enum before service writes", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalCreateQuote = crmQuotesService.createQuote;
  let called = false;
  crmQuotesService.createQuote = async () => {
    called = true;
    return { action: "created", quote: { id: "quote-1" } };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/quotes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        currency: "USD",
        status: "MADE_UP_STATUS",
        lineItems: [
          {
            itemType: "CUSTOM_SERVICE",
            description: "Private tour",
            quantity: 1,
            unitPrice: 100
          }
        ]
      })
    });

    assert.equal(response.status, 422);
    assert.equal(called, false);
  } finally {
    crmQuotesService.createQuote = originalCreateQuote;
    restoreUser();
    await close(server);
  }
});

test("CRM quote conversion route validates booking lookup before service writes", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalConvertQuote = crmQuotesService.convertQuoteToBooking;
  let called = false;
  crmQuotesService.convertQuoteToBooking = async () => {
    called = true;
    return { action: "converted", quote: { id: "quote-1" } };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/quotes/66eeeeeeeeeeeeeeeeeeeeee/convert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({})
    });

    assert.equal(response.status, 422);
    assert.equal(called, false);
  } finally {
    crmQuotesService.convertQuoteToBooking = originalConvertQuote;
    restoreUser();
    await close(server);
  }
});

test("CRM quote conversion route links accepted quote through service", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalConvertQuote = crmQuotesService.convertQuoteToBooking;
  let received = null;
  crmQuotesService.convertQuoteToBooking = async (payload) => {
    received = payload;
    return {
      action: "converted",
      quote: {
        id: payload.quoteId,
        quoteNumber: "QTE-1",
        status: "CONVERTED",
        convertedBookingId: "66dddddddddddddddddddddd",
        bokunBookingId: "BKN-1"
      },
      bookingCreated: false
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/quotes/66eeeeeeeeeeeeeeeeeeeeee/convert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        bookingReference: "ZNZ-CONFIRMED-1",
        conversionNote: "Confirmed by Bokun sync"
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(received.quoteId, "66eeeeeeeeeeeeeeeeeeeeee");
    assert.equal(received.payload.bookingReference, "ZNZ-CONFIRMED-1");
    assert.equal(payload.data.bookingCreated, false);
  } finally {
    crmQuotesService.convertQuoteToBooking = originalConvertQuote;
    restoreUser();
    await close(server);
  }
});

test("CRM follow-ups route requires auth and returns scheduled work", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalListFollowUps = crmFollowUpsService.listFollowUps;
  crmFollowUpsService.listFollowUps = async () => ({
    items: [
      {
        id: "follow-up-1",
        type: "CALL",
        status: "PENDING",
        dueAt: "2026-08-23T09:00:00.000Z",
        priority: "HIGH"
      }
    ],
    count: 1,
    page: 1,
    limit: 50
  });
  const server = await listen();

  try {
    const { port } = server.address();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/crm/follow-ups`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/follow-ups?status=PENDING`, {
      headers: { Authorization: `Bearer ${adminToken()}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].type, "CALL");
  } finally {
    crmFollowUpsService.listFollowUps = originalListFollowUps;
    restoreUser();
    await close(server);
  }
});

test("CRM follow-up create route validates type enum before service writes", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalCreateFollowUp = crmFollowUpsService.createFollowUp;
  let called = false;
  crmFollowUpsService.createFollowUp = async () => {
    called = true;
    return { action: "created", followUp: { id: "follow-up-1" } };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/follow-ups`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        customerId: "66eeeeeeeeeeeeeeeeeeeeee",
        type: "MADE_UP_TYPE",
        dueAt: "2026-08-23T09:00:00.000Z"
      })
    });

    assert.equal(response.status, 422);
    assert.equal(called, false);
  } finally {
    crmFollowUpsService.createFollowUp = originalCreateFollowUp;
    restoreUser();
    await close(server);
  }
});

test("CRM tasks route requires auth and returns sales task queue", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalListTasks = crmFollowUpsService.listTasks;
  crmFollowUpsService.listTasks = async () => ({
    items: [
      {
        id: "task-1",
        title: "Call customer",
        status: "TODO",
        priority: "NORMAL"
      }
    ],
    count: 1,
    page: 1,
    limit: 50
  });
  const server = await listen();

  try {
    const { port } = server.address();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/crm/tasks`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/tasks?status=TODO`, {
      headers: { Authorization: `Bearer ${adminToken()}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].title, "Call customer");
  } finally {
    crmFollowUpsService.listTasks = originalListTasks;
    restoreUser();
    await close(server);
  }
});

test("CRM task create route validates status enum before service writes", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalCreateTask = crmFollowUpsService.createTask;
  let called = false;
  crmFollowUpsService.createTask = async () => {
    called = true;
    return { action: "created", task: { id: "task-1" } };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        title: "Call customer",
        status: "MADE_UP_STATUS"
      })
    });

    assert.equal(response.status, 422);
    assert.equal(called, false);
  } finally {
    crmFollowUpsService.createTask = originalCreateTask;
    restoreUser();
    await close(server);
  }
});

test("CRM sales pipeline route requires opportunity permission and returns stage columns", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalPipeline = crmOpportunitiesService.getSalesPipeline;
  crmOpportunitiesService.getSalesPipeline = async () => ({
    stageOrder: ["NEW", "QUALIFIED"],
    columns: [
      {
        stage: "NEW",
        label: "New",
        count: 1,
        totalEstimatedValue: 100,
        weightedValue: 10,
        items: []
      }
    ],
    totals: { count: 1, openCount: 1, totalEstimatedValue: 100, weightedValue: 10 },
    pipelineValueIsForecastOnly: true,
    actualRevenueSource: "Booking Accounting after Bokun confirmed booking"
  });
  const server = await listen();

  try {
    const { port } = server.address();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/crm/pipeline`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/pipeline?includeClosed=false&limitPerStage=5`, {
      headers: { Authorization: `Bearer ${adminToken()}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.columns[0].stage, "NEW");
    assert.equal(payload.data.pipelineValueIsForecastOnly, true);
  } finally {
    crmOpportunitiesService.getSalesPipeline = originalPipeline;
    restoreUser();
    await close(server);
  }
});

test("CRM B2B partners route requires B2B permission and returns partner pipeline data", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalListB2BPartners = crmB2BPartnersService.listB2BPartners;
  crmB2BPartnersService.listB2BPartners = async () => ({
    items: [
      {
        id: "b2b-1",
        partnerNumber: "B2B-1",
        partnerType: "TRAVEL_AGENT",
        companyName: "Spice Travel",
        status: "PROSPECT",
        accountingIntegration: { postsLedgerEntries: false }
      }
    ],
    count: 1,
    page: 1,
    limit: 50
  });
  const server = await listen();

  try {
    const { port } = server.address();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/crm/b2b-agents`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/b2b-agents?status=PROSPECT`, {
      headers: { Authorization: `Bearer ${adminToken()}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].partnerType, "TRAVEL_AGENT");
    assert.equal(payload.data.items[0].accountingIntegration.postsLedgerEntries, false);
  } finally {
    crmB2BPartnersService.listB2BPartners = originalListB2BPartners;
    restoreUser();
    await close(server);
  }
});

test("CRM B2B partner create route validates partner type before service writes", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalCreateB2BPartner = crmB2BPartnersService.createB2BPartner;
  let called = false;
  crmB2BPartnersService.createB2BPartner = async () => {
    called = true;
    return { action: "created", partner: { id: "b2b-1" } };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/b2b-agents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        partnerType: "MADE_UP_TYPE",
        companyName: "Spice Travel",
        contactPerson: "Asha Partner"
      })
    });

    assert.equal(response.status, 422);
    assert.equal(called, false);
  } finally {
    crmB2BPartnersService.createB2BPartner = originalCreateB2BPartner;
    restoreUser();
    await close(server);
  }
});

test("CRM B2B partner update route changes partner stage through service", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalUpdateB2BPartner = crmB2BPartnersService.updateB2BPartner;
  let received = null;
  crmB2BPartnersService.updateB2BPartner = async (payload) => {
    received = payload;
    return {
      action: "updated",
      partner: {
        id: payload.partnerId,
        status: payload.payload.status,
        accountingIntegration: { postsLedgerEntries: false }
      }
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/crm/b2b-agents/66eeeeeeeeeeeeeeeeeeeeee`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        status: "NEGOTIATION"
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.partner.status, "NEGOTIATION");
    assert.equal(payload.data.partner.accountingIntegration.postsLedgerEntries, false);
    assert.equal(received.partnerId, "66eeeeeeeeeeeeeeeeeeeeee");
  } finally {
    crmB2BPartnersService.updateB2BPartner = originalUpdateB2BPartner;
    restoreUser();
    await close(server);
  }
});
