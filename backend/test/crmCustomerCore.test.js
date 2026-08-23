process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/crm-customer-core-test";
process.env.JWT_SECRET ||= "crm-customer-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CRM_COMMUNICATION_CHANNEL,
  CRM_COMMUNICATION_DIRECTION,
  CRM_COMMUNICATION_STATUS,
  CUSTOMER_DUPLICATE_STATUS,
  CUSTOMER_TIMELINE_EVENT_TYPE,
  DUPLICATE_CANDIDATE_STATUS
} = require("../src/crm/constants");
const {
  createCustomerService,
  __testables
} = require("../src/services/customers");

const clone = (value) => JSON.parse(JSON.stringify(value));

const makeId = (index) => `64f00000000000000000${String(index).padStart(4, "0")}`.slice(0, 24);

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
    if (value && typeof value === "object" && value.$in) {
      return value.$in.includes(valueAtPath(row, key));
    }
    return String(valueAtPath(row, key) || "") === String(value || "");
  });
};

const createHarness = () => {
  const state = {
    customers: [],
    candidates: [],
    timeline: [],
    audits: [],
    bookings: [],
    payments: [],
    invoices: [],
    refunds: []
  };

  const CustomerModel = {
    findOne: (query) => queryResult(state.customers.find((customer) => matches(customer, query)) || null),
    find: (query) => queryResult(state.customers.filter((customer) => matches(customer, query))),
    findById: (id) => {
      const found = state.customers.find((customer) => String(customer._id) === String(id));
      return found ? wrapDoc(found, state, "customers") : null;
    },
    countDocuments: async (query) => state.customers.filter((customer) => matches(customer, query)).length,
    aggregate: async () => [],
    create: async (payload) => {
      const row = {
        _id: makeId(state.customers.length + 1),
        fullName: `${payload.firstName} ${payload.lastName}`.trim(),
        bookings: [],
        ...clone(payload),
        createdAt: "2026-08-20T08:00:00.000Z",
        updatedAt: "2026-08-20T08:00:00.000Z"
      };
      state.customers.push(row);
      return wrapDoc(row, state, "customers");
    }
  };

  const CustomerDuplicateCandidateModel = {
    findOne: (query) => queryResult(state.candidates.find((candidate) => matches(candidate, query)) || null),
    find: (query) => queryResult(state.candidates.filter((candidate) => matches(candidate, query))),
    countDocuments: async (query) => state.candidates.filter((candidate) => matches(candidate, query)).length,
    findById: (id) => {
      const found = state.candidates.find((candidate) => String(candidate._id) === String(id));
      return found ? wrapDoc(found, state, "candidates") : null;
    },
    create: async (payload) => {
      const exists = state.candidates.find(
        (candidate) =>
          String(candidate.primaryCustomerId) === String(payload.primaryCustomerId) &&
          String(candidate.duplicateCustomerId) === String(payload.duplicateCustomerId)
      );
      if (exists) {
        const error = new Error("Duplicate candidate");
        error.code = 11000;
        throw error;
      }
      const row = {
        _id: makeId(state.candidates.length + 101),
        ...clone(payload),
        createdAt: "2026-08-20T08:00:00.000Z",
        updatedAt: "2026-08-20T08:00:00.000Z"
      };
      state.candidates.push(row);
      return wrapDoc(row, state, "candidates");
    }
  };

  const CustomerTimelineEventModel = {
    find: (query) => queryResult(state.timeline.filter((event) => matches(event, query))),
    create: async (payload) => {
      const row = {
        _id: makeId(state.timeline.length + 201),
        ...clone(payload),
        createdAt: "2026-08-20T08:00:00.000Z"
      };
      state.timeline.push(row);
      return row;
    }
  };

  const AuditLogModel = {
    create: async (payload) => {
      state.audits.push(clone(payload));
      return payload;
    }
  };

  const findByBookingReference = (rows, query = {}) =>
    rows.filter((row) => (query.bookingReference?.$in || []).includes(row.bookingReference));

  const service = createCustomerService({
    CustomerModel,
    CustomerDuplicateCandidateModel,
    CustomerTimelineEventModel,
    AuditLogModel,
    BookingModel: { find: (query) => queryResult(state.bookings.filter((booking) => matches(booking, query))) },
    PaymentModel: { find: (query) => queryResult(findByBookingReference(state.payments, query)) },
    InvoiceModel: { find: (query) => queryResult(findByBookingReference(state.invoices, query)) },
    RefundModel: { find: (query) => queryResult(state.refunds.filter((refund) => matches(refund, query))) },
    now: () => new Date("2026-08-20T08:00:00.000Z")
  });

  return { service, state };
};

test("normalizes CRM customer identifiers and prevents exact duplicate customer creation", async () => {
  const { service, state } = createHarness();
  const first = await service.createCustomer({
    payload: {
      firstName: "Asha",
      lastName: "Traveler",
      email: "ASHA@EXAMPLE.COM",
      phone: "+255 778 775 044",
      tags: ["VIP", " vip "]
    },
    auth: { id: "admin-1", role: "admin", email: "admin@example.test" },
    requestId: "crm-test-1"
  });
  const second = await service.createCustomer({
    payload: {
      firstName: "Asha",
      lastName: "Traveler",
      email: "asha@example.com",
      phone: "+255778775044"
    },
    auth: { id: "admin-1", role: "admin", email: "admin@example.test" },
    requestId: "crm-test-2"
  });

  assert.equal(first.action, "created");
  assert.equal(first.customer.emailNormalized, "asha@example.com");
  assert.equal(first.customer.phoneNormalized, "+255778775044");
  assert.deepEqual(first.customer.tags, ["VIP"]);
  assert.equal(second.action, "existing");
  assert.equal(state.customers.length, 1);
  assert.ok(state.audits.some((audit) => audit.action === "crm_customer_duplicate_prevented"));
});

test("flags possible duplicates by phone while never matching by name only", async () => {
  const { service, state } = createHarness();
  await service.createCustomer({
    payload: {
      firstName: "Asha",
      lastName: "Traveler",
      email: "asha@example.com",
      phone: "+255778775044"
    }
  });
  const phoneMatch = await service.createCustomer({
    payload: {
      firstName: "Different",
      lastName: "Person",
      email: "different@example.com",
      phone: "+255 778 775 044"
    }
  });
  const nameOnly = await service.createCustomer({
    payload: {
      firstName: "Asha",
      lastName: "Traveler",
      email: "asha2@example.com",
      phone: "+255700000000"
    }
  });

  assert.equal(phoneMatch.duplicateReviewRequired, true);
  assert.equal(phoneMatch.customer.deduplicationStatus, CUSTOMER_DUPLICATE_STATUS.POSSIBLE_DUPLICATE);
  assert.equal(state.candidates.length, 1);
  assert.equal(state.candidates[0].status, DUPLICATE_CANDIDATE_STATUS.OPEN);
  assert.deepEqual(state.candidates[0].matchFields, ["phone"]);

  assert.equal(nameOnly.duplicateReviewRequired, false);
  assert.equal(nameOnly.customer.deduplicationStatus, CUSTOMER_DUPLICATE_STATUS.CLEAN);
  assert.equal(state.candidates.length, 1);
});

test("builds customer financial profile from booking accounting records without changing payments", async () => {
  const { service, state } = createHarness();
  const created = await service.createCustomer({
    payload: {
      firstName: "Zara",
      lastName: "Guest",
      email: "zara@example.com",
      phone: "+255700000001"
    }
  });
  state.bookings.push({
    _id: makeId(301),
    bookingReference: "ZNZ-CRM-1",
    bookingStatus: "confirmed",
    salesChannel: "DIRECT_WEBSITE",
    customer: {
      customerId: created.customer.id,
      email: "zara@example.com"
    }
  });
  state.payments.push({
    bookingReference: "ZNZ-CRM-1",
    status: "paid",
    amountPaid: 100,
    refundedAmount: 30,
    currency: "USD"
  });
  state.invoices.push({
    bookingReference: "ZNZ-CRM-1",
    invoiceNumber: "INV-CRM-1"
  });

  const profile = await service.getCustomerProfile(created.customer.id);
  const restricted = await service.getCustomerProfile(created.customer.id, { includeFinancials: false });

  assert.equal(profile.financialSummary.source, "local_accounting_records");
  assert.equal(profile.financialSummary.usesCanonicalProfitFormula, false);
  assert.equal(profile.financialSummary.amountPaid, 100);
  assert.equal(profile.financialSummary.amountRefunded, 30);
  assert.equal(profile.financialSummary.netCollected, 70);
  assert.equal(restricted.financialSummary.restricted, true);
});

test("logs manual WhatsApp communication into the customer timeline without fake delivery state", async () => {
  const { service, state } = createHarness();
  const created = await service.createCustomer({
    payload: {
      firstName: "Amina",
      lastName: "Guest",
      email: "amina@example.com",
      whatsappNumber: "+255700000002"
    },
    auth: { id: "admin-1", role: "admin", email: "admin@example.test" },
    requestId: "crm-communication-create"
  });

  const result = await service.logCustomerCommunication({
    customerId: created.customer.id,
    payload: {
      channel: CRM_COMMUNICATION_CHANNEL.WHATSAPP,
      direction: CRM_COMMUNICATION_DIRECTION.OUTBOUND,
      subject: "Private tour follow-up",
      summary: "WhatsApp follow-up logged manually.",
      note: "Customer asked for pickup details.",
      metadata: { campaign: "manual-follow-up" }
    },
    auth: { id: "admin-1", role: "admin", email: "admin@example.test" },
    requestId: "crm-communication-log"
  });

  assert.equal(result.action, "logged");
  assert.equal(result.event.eventType, CUSTOMER_TIMELINE_EVENT_TYPE.COMMUNICATION_LOGGED);
  assert.equal(result.event.communication.channel, CRM_COMMUNICATION_CHANNEL.WHATSAPP);
  assert.equal(result.event.communication.direction, CRM_COMMUNICATION_DIRECTION.OUTBOUND);
  assert.equal(result.event.communication.status, CRM_COMMUNICATION_STATUS.MANUAL_LOGGED);
  assert.equal(result.event.deliveryStatusIsProviderVerified, false);
  assert.equal(result.event.metadata.manualEntry, true);
  assert.equal(state.customers[0].lastCrmActivityAt, "2026-08-20T08:00:00.000Z");
  assert.ok(state.audits.some((audit) => audit.action === "crm_customer_communication_logged"));
});

test("sanitizes sensitive metadata in manual communication timeline entries", async () => {
  const { service, state } = createHarness();
  const created = await service.createCustomer({
    payload: {
      firstName: "Salma",
      lastName: "Traveler",
      email: "salma@example.com"
    }
  });

  const result = await service.logCustomerCommunication({
    customerId: created.customer.id,
    payload: {
      channel: CRM_COMMUNICATION_CHANNEL.EMAIL,
      direction: CRM_COMMUNICATION_DIRECTION.INBOUND,
      summary: "Email received from customer.",
      metadata: {
        authorization: "Bearer should-not-appear",
        nested: {
          apiSecret: "secret-value",
          safe: "keep-this"
        }
      }
    }
  });

  assert.equal(result.event.metadata.authorization, "[redacted]");
  assert.equal(result.event.metadata.nested.apiSecret, "[redacted]");
  assert.equal(result.event.metadata.nested.safe, "keep-this");
  const storedEvent = state.timeline.find((event) => event.eventType === CUSTOMER_TIMELINE_EVENT_TYPE.COMMUNICATION_LOGGED);
  assert.equal(storedEvent.metadata.authorization, "[redacted]");
});

test("CRM customer normalization helpers do not treat names as stable identifiers", () => {
  const patch = __testables.buildCustomerPatch({
    firstName: "Asha",
    lastName: "Traveler",
    email: "asha@example.com",
    phone: "+255 778 775 044"
  });

  assert.deepEqual(__testables.buildPossibleDuplicateClauses(patch), [
    { phoneNormalized: "+255778775044" }
  ]);
  assert.ok(!__testables.buildExactCustomerClauses(patch).some((clause) => clause.fullName));
});
