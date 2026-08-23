process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/crm-lead-core-test";
process.env.JWT_SECRET ||= "crm-lead-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CRM_LEAD_STATUS,
  CUSTOMER_TIMELINE_EVENT_TYPE
} = require("../src/crm/constants");
const {
  createCrmLeadService,
  __testables
} = require("../src/services/crmLeads");

const clone = (value) => JSON.parse(JSON.stringify(value));
const makeId = (index) => `65f00000000000000000${String(index).padStart(4, "0")}`.slice(0, 24);

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
    if (key === "externalReferences" && value.$elemMatch) {
      return (row.externalReferences || []).some((reference) => matches(reference, value.$elemMatch));
    }
    if (value instanceof RegExp) {
      return value.test(String(valueAtPath(row, key) || ""));
    }
    if (value && typeof value === "object" && value.$nin) {
      return !value.$nin.includes(valueAtPath(row, key));
    }
    if (value && typeof value === "object" && value.$in) {
      return value.$in.includes(valueAtPath(row, key));
    }
    return String(valueAtPath(row, key) || "") === String(value || "");
  });
};

const createHarness = () => {
  const state = {
    leads: [],
    customers: [],
    audits: [],
    timeline: []
  };

  const LeadModel = {
    findOne: (query) => queryResult(state.leads.find((lead) => matches(lead, query)) || null),
    find: (query) => queryResult(state.leads.filter((lead) => matches(lead, query))),
    findById: (id) => {
      const found = state.leads.find((lead) => String(lead._id) === String(id));
      return found ? wrapDoc(found, state, "leads") : null;
    },
    countDocuments: async (query) => state.leads.filter((lead) => matches(lead, query)).length,
    aggregate: async () => [],
    create: async (payload) => {
      const row = {
        _id: makeId(state.leads.length + 1),
        leadReference: payload.leadReference || `LED-TEST-${state.leads.length + 1}`,
        fullName: `${payload.firstName} ${payload.lastName}`.trim(),
        ...clone(payload),
        createdAt: "2026-08-22T08:00:00.000Z",
        updatedAt: "2026-08-22T08:00:00.000Z"
      };
      state.leads.push(row);
      return wrapDoc(row, state, "leads");
    }
  };

  const CustomerModel = {
    findOne: (query) => queryResult(state.customers.find((customer) => matches(customer, query)) || null)
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

  const customerService = {
    createCustomer: async ({ payload }) => {
      const customer = {
        _id: makeId(state.customers.length + 101),
        id: makeId(state.customers.length + 101),
        ...clone(payload)
      };
      state.customers.push(customer);
      return {
        action: "created",
        customer
      };
    }
  };

  const service = createCrmLeadService({
    LeadModel,
    CustomerModel,
    AuditLogModel,
    CustomerTimelineEventModel,
    customerService,
    now: () => new Date("2026-08-22T08:00:00.000Z")
  });

  return { service, state };
};

test("creates normalized CRM sales leads and prevents active duplicate leads by email", async () => {
  const { service, state } = createHarness();
  const first = await service.createLead({
    payload: {
      firstName: "Asha",
      lastName: "Traveler",
      email: "ASHA@EXAMPLE.COM",
      phone: "+255 778 775 044",
      tags: ["VIP", "vip"]
    }
  });
  const second = await service.createLead({
    payload: {
      firstName: "Asha",
      lastName: "Traveler",
      email: "asha@example.com",
      phone: "+255778775044"
    }
  });

  assert.equal(first.action, "created");
  assert.equal(first.lead.emailNormalized, "asha@example.com");
  assert.equal(first.lead.phoneNormalized, "+255778775044");
  assert.deepEqual(first.lead.tags, ["VIP"]);
  assert.equal(second.action, "existing");
  assert.equal(state.leads.length, 1);
  assert.ok(state.audits.some((audit) => audit.action === "crm_lead_duplicate_prevented"));
});

test("flags possible duplicate leads by phone but never by name only", async () => {
  const { service, state } = createHarness();
  await service.createLead({
    payload: {
      firstName: "Asha",
      lastName: "Traveler",
      email: "asha@example.com",
      phone: "+255778775044"
    }
  });
  const phoneMatch = await service.createLead({
    payload: {
      firstName: "Different",
      lastName: "Person",
      email: "different@example.com",
      phone: "+255 778 775 044"
    }
  });
  const nameOnly = await service.createLead({
    payload: {
      firstName: "Asha",
      lastName: "Traveler",
      email: "asha2@example.com",
      phone: "+255700000001"
    }
  });

  assert.equal(phoneMatch.duplicateReviewRequired, true);
  assert.equal(phoneMatch.lead.duplicateReasons.includes("phone"), true);
  assert.equal(nameOnly.duplicateReviewRequired, false);
  assert.equal(state.leads.length, 3);
});

test("updates lead status and clears stale terminal reasons when status changes", async () => {
  const { service, state } = createHarness();
  const created = await service.createLead({
    payload: {
      firstName: "Juma",
      lastName: "Guest",
      email: "juma@example.com",
      status: CRM_LEAD_STATUS.LOST,
      lostReason: "Price"
    }
  });
  const updated = await service.updateLead({
    leadId: created.lead.id,
    payload: {
      status: CRM_LEAD_STATUS.QUALIFIED
    }
  });

  assert.equal(updated.lead.status, CRM_LEAD_STATUS.QUALIFIED);
  assert.equal(updated.lead.lostReason, "");
  assert.equal(state.audits.some((audit) => audit.action === "crm_lead_updated"), true);
});

test("converts a lead into a customer exactly once and records customer timeline evidence", async () => {
  const { service, state } = createHarness();
  const created = await service.createLead({
    payload: {
      firstName: "Zara",
      lastName: "Guest",
      email: "zara@example.com",
      source: "WHATSAPP"
    }
  });
  const converted = await service.convertLeadToCustomer({ leadId: created.lead.id });
  const repeated = await service.convertLeadToCustomer({ leadId: created.lead.id });

  assert.equal(converted.action, "converted");
  assert.equal(converted.lead.status, CRM_LEAD_STATUS.CONVERTED);
  assert.equal(repeated.action, "already_converted");
  assert.equal(state.customers.length, 1);
  assert.equal(state.timeline[0].eventType, CUSTOMER_TIMELINE_EVENT_TYPE.LEAD_CONVERTED_TO_CUSTOMER);
});

test("lead helper clauses do not use names as stable duplicate identifiers", () => {
  const patch = __testables.buildLeadPatch({
    firstName: "Asha",
    lastName: "Traveler",
    email: "asha@example.com",
    phone: "+255 778 775 044"
  });

  assert.ok(!__testables.buildExactLeadClauses(patch).some((clause) => clause.fullName));
  assert.deepEqual(__testables.buildPossibleLeadClauses(patch), [
    { phoneNormalized: "+255778775044", status: { $nin: [CRM_LEAD_STATUS.CONVERTED, CRM_LEAD_STATUS.ARCHIVED] } }
  ]);
});
