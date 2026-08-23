process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/crm-follow-up-core-test";
process.env.JWT_SECRET ||= "crm-follow-up-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CRM_FOLLOW_UP_STATUS,
  CRM_FOLLOW_UP_TYPE,
  CRM_TASK_STATUS
} = require("../src/crm/constants");
const {
  createCrmFollowUpService
} = require("../src/services/crmFollowUps");

const clone = (value) => JSON.parse(JSON.stringify(value));
const makeId = (index) => `65f33333333333333333${String(index).padStart(4, "0")}`.slice(0, 24);

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
  if (!query || !Object.keys(query).length) return true;
  if (query.$or) return query.$or.some((clause) => matches(row, clause));
  return Object.entries(query).every(([key, value]) => {
    const actual = valueAtPath(row, key);
    if (value instanceof RegExp) return value.test(String(actual || ""));
    if (value && typeof value === "object" && value.$lte) return new Date(actual).getTime() <= new Date(value.$lte).getTime();
    if (value && typeof value === "object" && value.$gte) return new Date(actual).getTime() >= new Date(value.$gte).getTime();
    if (value && typeof value === "object" && value.$in) return value.$in.includes(actual);
    return String(actual || "") === String(value || "");
  });
};

const createHarness = () => {
  const state = {
    followUps: [],
    tasks: [],
    leads: [
      {
        _id: makeId(1),
        leadReference: "LED-1",
        fullName: "Asha Traveler",
        customerId: makeId(2)
      }
    ],
    opportunities: [],
    customers: [
      {
        _id: makeId(2),
        fullName: "Asha Traveler"
      }
    ],
    quotes: [],
    audits: [],
    timeline: []
  };

  const makeModel = (collectionName) => ({
    find: (query) => queryResult(state[collectionName].filter((row) => matches(row, query))),
    findById: (id) => {
      const found = state[collectionName].find((row) => String(row._id) === String(id));
      return found ? wrapDoc(found, state, collectionName) : null;
    },
    countDocuments: async (query) => state[collectionName].filter((row) => matches(row, query)).length,
    create: async (payload) => {
      const row = {
        _id: makeId(state[collectionName].length + 101),
        ...clone(payload),
        createdAt: "2026-08-23T08:00:00.000Z",
        updatedAt: "2026-08-23T08:00:00.000Z"
      };
      state[collectionName].push(row);
      return wrapDoc(row, state, collectionName);
    }
  });

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

  const service = createCrmFollowUpService({
    FollowUpModel: makeModel("followUps"),
    CrmTaskModel: makeModel("tasks"),
    LeadModel: makeModel("leads"),
    SalesOpportunityModel: makeModel("opportunities"),
    CustomerModel: makeModel("customers"),
    QuoteModel: makeModel("quotes"),
    AuditLogModel,
    CustomerTimelineEventModel,
    now: () => new Date("2026-08-23T08:00:00.000Z")
  });

  return { service, state };
};

test("creates an overdue follow-up linked to a lead and customer timeline", async () => {
  const { service, state } = createHarness();

  const result = await service.createFollowUp({
    payload: {
      leadId: state.leads[0]._id,
      type: CRM_FOLLOW_UP_TYPE.WHATSAPP,
      dueAt: "2026-08-23T07:00:00.000Z",
      priority: "HIGH",
      notes: "Check customer decision"
    }
  });

  assert.equal(result.action, "created");
  assert.equal(result.followUp.customerId, state.customers[0]._id);
  assert.equal(result.followUp.overdue, true);
  assert.equal(state.audits.some((audit) => audit.action === "crm_follow_up_created"), true);
  assert.equal(state.timeline.some((entry) => entry.eventType === "FOLLOW_UP_CREATED"), true);
});

test("completes a follow-up with audit and timeline evidence", async () => {
  const { service, state } = createHarness();
  const created = await service.createFollowUp({
    payload: {
      leadId: state.leads[0]._id,
      dueAt: "2026-08-23T09:00:00.000Z"
    }
  });

  const completed = await service.completeFollowUp({
    followUpId: created.followUp.id,
    outcome: "Customer asked for revised dates"
  });

  assert.equal(completed.followUp.status, CRM_FOLLOW_UP_STATUS.COMPLETED);
  assert.ok(completed.followUp.completedAt);
  assert.equal(completed.followUp.outcome, "Customer asked for revised dates");
  assert.equal(state.audits.some((audit) => audit.action === "crm_follow_up_status_changed"), true);
  assert.equal(state.timeline.some((entry) => entry.eventType === "FOLLOW_UP_COMPLETED"), true);
});

test("rejects follow-ups without CRM context", async () => {
  const { service } = createHarness();

  await assert.rejects(
    () => service.createFollowUp({
      payload: {
        dueAt: "2026-08-23T09:00:00.000Z"
      }
    }),
    { code: "CRM_FOLLOW_UP_RELATION_REQUIRED" }
  );
});

test("creates and completes sales tasks without booking side effects", async () => {
  const { service, state } = createHarness();

  const created = await service.createTask({
    payload: {
      title: "Prepare revised safari itinerary",
      description: "Use customer budget notes",
      dueDate: "2026-08-23T07:30:00.000Z",
      priority: "URGENT"
    }
  });
  const completed = await service.completeTask({
    taskId: created.task.id,
    outcome: "Revised itinerary sent"
  });

  assert.equal(created.task.overdue, true);
  assert.equal(completed.task.status, CRM_TASK_STATUS.DONE);
  assert.equal(completed.task.outcome, "Revised itinerary sent");
  assert.equal(state.audits.some((audit) => audit.action === "crm_task_created"), true);
  assert.equal(state.audits.some((audit) => audit.action === "crm_task_status_changed"), true);
  assert.equal(completed.task.relatedEntityId, "");
});

test("follow-up dashboard metrics expose due work without mixing revenue", async () => {
  const { service, state } = createHarness();
  await service.createFollowUp({
    payload: {
      leadId: state.leads[0]._id,
      dueAt: "2026-08-23T07:00:00.000Z"
    }
  });
  await service.createTask({
    payload: {
      title: "Call hotel partner",
      dueDate: "2026-08-23T07:00:00.000Z"
    }
  });
  await service.createTask({
    payload: {
      title: "Done task",
      status: CRM_TASK_STATUS.DONE,
      dueDate: "2026-08-23T07:00:00.000Z"
    }
  });

  const metrics = await service.getFollowUpDashboardMetrics();

  assert.equal(metrics.followUpCount, 1);
  assert.equal(metrics.pendingFollowUpCount, 1);
  assert.equal(metrics.followUpsDueCount, 1);
  assert.equal(metrics.taskCount, 2);
  assert.equal(metrics.openTaskCount, 1);
  assert.equal(metrics.tasksDueCount, 1);
});
