process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/crm-opportunity-core-test";
process.env.JWT_SECRET ||= "crm-opportunity-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CRM_LEAD_STATUS,
  CRM_LOST_REASON,
  CRM_OPPORTUNITY_STAGE
} = require("../src/crm/constants");
const {
  createCrmOpportunityService
} = require("../src/services/crmOpportunities");

const clone = (value) => JSON.parse(JSON.stringify(value));
const makeId = (index) => `65f11111111111111111${String(index).padStart(4, "0")}`.slice(0, 24);

const wrapDoc = (row, state, collectionName) => ({
  ...clone(row),
  toObject() {
    const { save, toObject, ...plain } = this;
    return clone(plain);
  },
  async save() {
    const index = state[collectionName].findIndex((item) => String(item._id) === String(this._id));
    const plain = this.toObject();
    if (index >= 0) state[collectionName][index] = plain;
    else state[collectionName].push(plain);
    return this;
  }
});

const queryResult = (value) => ({
  sort() {
    return this;
  },
  skip() {
    return this;
  },
  limit() {
    return this;
  },
  populate() {
    return this;
  },
  async lean() {
    return clone(value);
  }
});

const valueAtPath = (row, key) =>
  key.split(".").reduce((current, part) => (current === undefined || current === null ? undefined : current[part]), row);

const matches = (row, query = {}) => {
  if (query.$or) return query.$or.some((clause) => matches(row, clause));
  return Object.entries(query).every(([key, value]) => {
    if (value instanceof RegExp) {
      return value.test(String(valueAtPath(row, key) || ""));
    }
    if (value && typeof value === "object" && value.$nin) {
      return !value.$nin.includes(valueAtPath(row, key));
    }
    return String(valueAtPath(row, key) || "") === String(value || "");
  });
};

const createHarness = () => {
  const state = {
    opportunities: [],
    leads: [
      {
        _id: makeId(1),
        leadReference: "LED-1",
        firstName: "Asha",
        lastName: "Traveler",
        fullName: "Asha Traveler",
        email: "asha@example.com",
        source: "WHATSAPP",
        status: CRM_LEAD_STATUS.NEW,
        travelIntent: { budgetAmount: 500, budgetCurrency: "USD" },
        interestedProducts: [{ productId: "P-1", productTitle: "Stone Town Tour" }]
      }
    ],
    bookings: [
      {
        _id: makeId(31),
        bookingReference: "ZNZ-WON-1",
        bokunBookingId: "BKN-123",
        bokunConfirmationCode: "CONF-123",
        bookingStatus: "confirmed",
        supplierStatus: "confirmed",
        operationalSource: "BOKUN",
        bokunStatus: {
          raw: "CONFIRMED",
          normalized: "confirmed"
        }
      },
      {
        _id: makeId(32),
        bookingReference: "ZNZ-PENDING-1",
        bokunBookingId: "BKN-PENDING",
        bookingStatus: "pending",
        supplierStatus: "supplier_pending",
        bokunStatus: {
          raw: "PENDING",
          normalized: "pending"
        }
      }
    ],
    audits: [],
    timeline: []
  };

  const SalesOpportunityModel = {
    findOne: (query) => queryResult(state.opportunities.find((opportunity) => matches(opportunity, query)) || null),
    find: (query) => queryResult(state.opportunities.filter((opportunity) => matches(opportunity, query))),
    findById: (id) => {
      const found = state.opportunities.find((opportunity) => String(opportunity._id) === String(id));
      return found ? wrapDoc(found, state, "opportunities") : null;
    },
    countDocuments: async (query) => state.opportunities.filter((opportunity) => matches(opportunity, query)).length,
    aggregate: async (pipeline = []) => {
      const matchStage = pipeline.find((stage) => stage.$match)?.$match || {};
      const rows = state.opportunities.filter((opportunity) => matches(opportunity, matchStage));
      const group = pipeline.find((stage) => stage.$group)?.$group || {};
      if (group._id === "$currency") {
        return Object.values(rows.reduce((acc, row) => {
          const currency = row.currency || "USD";
          acc[currency] ||= { _id: currency, openPipelineValue: 0, weightedPipelineValue: 0 };
          acc[currency].openPipelineValue += Number(row.estimatedValue || 0);
          acc[currency].weightedPipelineValue += Number(row.estimatedValue || 0) * (Number(row.probability || 0) / 100);
          return acc;
        }, {}));
      }
      return Object.values(rows.reduce((acc, row) => {
        const stage = row.stage || CRM_OPPORTUNITY_STAGE.NEW;
        acc[stage] ||= { _id: stage, count: 0, totalEstimatedValue: 0, weightedValue: 0 };
        acc[stage].count += 1;
        acc[stage].totalEstimatedValue += Number(row.estimatedValue || 0);
        acc[stage].weightedValue += Number(row.estimatedValue || 0) * (Number(row.probability || 0) / 100);
        return acc;
      }, {}));
    },
    create: async (payload) => {
      const row = {
        _id: makeId(state.opportunities.length + 101),
        opportunityNumber: payload.opportunityNumber || `OPP-TEST-${state.opportunities.length + 1}`,
        ...clone(payload),
        createdAt: "2026-08-22T08:00:00.000Z",
        updatedAt: "2026-08-22T08:00:00.000Z"
      };
      state.opportunities.push(row);
      return wrapDoc(row, state, "opportunities");
    }
  };

  const LeadModel = {
    findById: (id) => {
      const found = state.leads.find((lead) => String(lead._id) === String(id));
      return found ? wrapDoc(found, state, "leads") : null;
    }
  };

  const BookingModel = {
    findById: (id) => queryResult(state.bookings.find((booking) => String(booking._id) === String(id)) || null),
    findOne: (query) => queryResult(state.bookings.find((booking) => matches(booking, query)) || null)
  };

  const AuditLogModel = {
    create: async (payload) => {
      state.audits.push(clone(payload));
      return payload;
    }
  };

  const CustomerTimelineEventModel = {
    create: async (payload) => {
      state.timeline.push(clone(payload));
      return payload;
    }
  };

  const service = createCrmOpportunityService({
    SalesOpportunityModel,
    LeadModel,
    BookingModel,
    AuditLogModel,
    CustomerTimelineEventModel,
    now: () => new Date("2026-08-22T08:00:00.000Z")
  });

  return { service, state };
};

test("converts a lead into one sales opportunity without duplicate pipeline value", async () => {
  const { service, state } = createHarness();
  const leadId = state.leads[0]._id;

  const created = await service.convertLeadToOpportunity({ leadId });
  const repeated = await service.convertLeadToOpportunity({ leadId });

  assert.equal(created.action, "created");
  assert.equal(repeated.action, "existing");
  assert.equal(state.opportunities.length, 1);
  assert.equal(state.leads[0].status, CRM_LEAD_STATUS.QUALIFIED);
  assert.equal(created.opportunity.estimatedValue, 500);
  assert.equal(created.opportunity.source, "WHATSAPP");
  assert.equal(state.audits.some((audit) => audit.action === "crm_lead_converted_to_opportunity"), true);
  assert.equal(state.audits.some((audit) => audit.metadata?.pipelineValueIsForecastOnly), true);
});

test("prevents WON opportunities without confirmed booking evidence", async () => {
  const { service, state } = createHarness();

  await assert.rejects(
    () => service.createOpportunity({
      payload: {
        title: "Safari deposit",
        stage: CRM_OPPORTUNITY_STAGE.WON,
        estimatedValue: 300
      }
    }),
    { code: "CRM_OPPORTUNITY_WON_BOOKING_EVIDENCE_REQUIRED" }
  );

  await assert.rejects(
    () => service.createOpportunity({
      payload: {
        title: "Safari deposit",
        stage: CRM_OPPORTUNITY_STAGE.WON,
        estimatedValue: 300,
        wonBokunBookingId: "BKN-PENDING"
      }
    }),
    { code: "CRM_BOOKING_CONFIRMATION_REQUIRED" }
  );

  const created = await service.createOpportunity({
    payload: {
      title: "Safari deposit",
      stage: CRM_OPPORTUNITY_STAGE.WON,
      estimatedValue: 300,
      wonBokunBookingId: "BKN-123"
    }
  });

  assert.equal(created.opportunity.stage, CRM_OPPORTUNITY_STAGE.WON);
  assert.equal(created.opportunity.probability, 100);
  assert.equal(String(created.opportunity.wonBookingId), state.bookings[0]._id);
  assert.equal(state.opportunities.length, 1);
});

test("lost opportunities require a reason and clear stale lost data when reopened", async () => {
  const { service } = createHarness();

  const created = await service.createOpportunity({
    payload: {
      title: "Private transfer",
      stage: CRM_OPPORTUNITY_STAGE.LOST,
      lostReason: CRM_LOST_REASON.PRICE_TOO_HIGH,
      lostReasonNote: "Customer selected another operator"
    }
  });
  const reopened = await service.updateOpportunity({
    opportunityId: created.opportunity.id,
    payload: {
      stage: CRM_OPPORTUNITY_STAGE.QUALIFIED
    }
  });

  assert.equal(created.opportunity.stage, CRM_OPPORTUNITY_STAGE.LOST);
  assert.equal(reopened.opportunity.stage, CRM_OPPORTUNITY_STAGE.QUALIFIED);
  assert.equal(reopened.opportunity.lostReason, "");
  assert.equal(reopened.opportunity.lostAt, null);
});

test("pipeline metrics keep forecast value separate from accounting revenue", async () => {
  const { service } = createHarness();
  await service.createOpportunity({
    payload: {
      title: "Stone Town",
      stage: CRM_OPPORTUNITY_STAGE.QUALIFIED,
      estimatedValue: 100,
      probability: 25
    }
  });
  await service.createOpportunity({
    payload: {
      title: "Safari",
      stage: CRM_OPPORTUNITY_STAGE.NEGOTIATION,
      estimatedValue: 200,
      probability: 50
    }
  });
  await service.createOpportunity({
    payload: {
      title: "Lost inquiry",
      stage: CRM_OPPORTUNITY_STAGE.LOST,
      estimatedValue: 999,
      lostReason: CRM_LOST_REASON.NO_RESPONSE
    }
  });

  const metrics = await service.getOpportunityDashboardMetrics();

  assert.equal(metrics.openOpportunityCount, 2);
  assert.equal(metrics.lostOpportunityCount, 1);
  assert.equal(metrics.openPipelineValue, 300);
  assert.equal(metrics.weightedPipelineValue, 125);
});

test("sales pipeline groups opportunities by stage and labels value as forecast only", async () => {
  const { service } = createHarness();
  await service.createOpportunity({
    payload: {
      title: "Stone Town",
      stage: CRM_OPPORTUNITY_STAGE.QUALIFIED,
      estimatedValue: 100,
      probability: 25
    }
  });
  await service.createOpportunity({
    payload: {
      title: "Safari",
      stage: CRM_OPPORTUNITY_STAGE.NEGOTIATION,
      estimatedValue: 200,
      probability: 50
    }
  });
  await service.createOpportunity({
    payload: {
      title: "Won booking",
      stage: CRM_OPPORTUNITY_STAGE.WON,
      estimatedValue: 300,
      wonBokunBookingId: "BKN-123"
    }
  });

  const openPipeline = await service.getSalesPipeline({ includeClosed: false, limitPerStage: 5 });
  const closedPipeline = await service.getSalesPipeline({ includeClosed: true, limitPerStage: 5 });

  assert.equal(openPipeline.pipelineValueIsForecastOnly, true);
  assert.equal(openPipeline.actualRevenueSource, "Booking Accounting after Bokun confirmed booking");
  assert.equal(openPipeline.columns.some((column) => column.stage === CRM_OPPORTUNITY_STAGE.WON), false);
  assert.equal(openPipeline.totals.count, 2);
  assert.equal(openPipeline.totals.weightedValue, 125);
  assert.equal(closedPipeline.columns.some((column) => column.stage === CRM_OPPORTUNITY_STAGE.WON), true);
});
