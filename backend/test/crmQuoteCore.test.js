process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/crm-quote-core-test";
process.env.JWT_SECRET ||= "crm-quote-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CRM_OPPORTUNITY_STAGE,
  CRM_QUOTE_STATUS
} = require("../src/crm/constants");
const {
  createCrmQuoteService
} = require("../src/services/crmQuotes");

const clone = (value) => JSON.parse(JSON.stringify(value));
const makeId = (index) => `65f22222222222222222${String(index).padStart(4, "0")}`.slice(0, 24);

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

const valueAtPath = (row, key) =>
  key.split(".").reduce((current, part) => (current === undefined || current === null ? undefined : current[part]), row);

const matches = (row, query = {}) => {
  if (!query || !Object.keys(query).length) return true;
  if (query.$or) return query.$or.some((clause) => matches(row, clause));
  return Object.entries(query).every(([key, value]) => {
    if (value instanceof RegExp) return value.test(String(valueAtPath(row, key) || ""));
    return String(valueAtPath(row, key) || "") === String(value || "");
  });
};

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

const createHarness = () => {
  const state = {
    quotes: [],
    opportunities: [
      {
        _id: makeId(21),
        opportunityNumber: "OPP-QTE-1",
        title: "Private safari",
        stage: CRM_OPPORTUNITY_STAGE.READY_TO_BOOK,
        probability: 85,
        customerId: makeId(31),
        externalReferences: []
      }
    ],
    bookings: [
      {
        _id: makeId(41),
        bookingReference: "ZNZ-CONFIRMED-1",
        bokunBookingId: "BKN-CONFIRMED-1",
        bokunConfirmationCode: "CONF-1",
        bookingStatus: "confirmed",
        supplierStatus: "confirmed",
        operationalSource: "BOKUN",
        bokunStatus: {
          raw: "CONFIRMED",
          normalized: "confirmed"
        },
        currency: "USD",
        amount: 195
      },
      {
        _id: makeId(42),
        bookingReference: "ZNZ-PENDING-1",
        bokunBookingId: "BKN-PENDING-1",
        bookingStatus: "pending",
        supplierStatus: "supplier_pending",
        bokunStatus: {
          raw: "PENDING",
          normalized: "pending"
        }
      }
    ],
    customers: [
      {
        _id: makeId(31),
        fullName: "Asha Traveler",
        email: "asha@example.test"
      }
    ],
    audits: [],
    timeline: []
  };

  const QuoteModel = {
    find: (query) => queryResult(state.quotes.filter((quote) => matches(quote, query))),
    findOne: (query) => queryResult(state.quotes.find((quote) => matches(quote, query)) || null),
    findById: (id) => {
      const found = state.quotes.find((quote) => String(quote._id) === String(id));
      return found ? wrapDoc(found, state, "quotes") : null;
    },
    countDocuments: async (query) => state.quotes.filter((quote) => matches(quote, query)).length,
    aggregate: async () =>
      Object.values(state.quotes.reduce((acc, quote) => {
        const status = quote.status || CRM_QUOTE_STATUS.DRAFT;
        acc[status] ||= { _id: status, count: 0, totalValue: 0 };
        acc[status].count += 1;
        acc[status].totalValue += Number(quote.total || 0);
        return acc;
      }, {})),
    create: async (payload) => {
      const row = {
        _id: makeId(state.quotes.length + 101),
        quoteNumber: payload.quoteNumber || `QTE-TEST-${state.quotes.length + 1}`,
        ...clone(payload),
        createdAt: "2026-08-23T08:00:00.000Z",
        updatedAt: "2026-08-23T08:00:00.000Z"
      };
      state.quotes.push(row);
      return wrapDoc(row, state, "quotes");
    }
  };

  const SalesOpportunityModel = {
    findById: (id) => {
      const found = state.opportunities.find((opportunity) => String(opportunity._id) === String(id));
      return found ? wrapDoc(found, state, "opportunities") : null;
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

  const service = createCrmQuoteService({
    QuoteModel,
    LeadModel: { findById: async () => null },
    SalesOpportunityModel,
    BookingModel,
    CustomerModel: {
      findById: (id) => {
        const found = state.customers.find((customer) => String(customer._id) === String(id));
        return found ? wrapDoc(found, state, "customers") : null;
      }
    },
    AuditLogModel,
    CustomerTimelineEventModel,
    now: () => new Date("2026-08-23T08:00:00.000Z")
  });

  return { service, state };
};

const baseQuotePayload = (overrides = {}) => ({
  currency: "USD",
  lineItems: [
    {
      itemType: "CUSTOM_SERVICE",
      description: "Private safari package",
      quantity: 2,
      unitPrice: 100,
      discount: 10,
      tax: 5,
      lineTotal: 999
    }
  ],
  notes: "CRM quote only",
  ...overrides
});

test("creates a CRM quote with server-calculated totals and forecast-only accounting guardrail", async () => {
  const { service, state } = createHarness();

  const result = await service.createQuote({
    payload: {
      ...baseQuotePayload(),
      subtotal: 999,
      total: 999
    }
  });

  assert.equal(result.action, "created");
  assert.equal(result.quote.subtotal, 200);
  assert.equal(result.quote.discount, 10);
  assert.equal(result.quote.tax, 5);
  assert.equal(result.quote.total, 195);
  assert.equal(result.quote.quoteValueIsForecastOnly, true);
  assert.equal(result.quote.actualRevenueSource, "Booking Accounting after Bokun confirmed booking");
  assert.equal(state.audits.some((audit) => audit.action === "crm_quote_created"), true);
  assert.equal(state.audits.some((audit) => audit.metadata?.quoteValueIsForecastOnly), true);
});

test("locks quote commercial amounts after approval and sending", async () => {
  const { service } = createHarness();
  const created = await service.createQuote({ payload: baseQuotePayload() });
  const approved = await service.approveQuote({ quoteId: created.quote.id });
  const sent = await service.sendQuote({ quoteId: created.quote.id });

  await assert.rejects(
    () => service.updateQuote({
      quoteId: created.quote.id,
      payload: {
        lineItems: [
          {
            itemType: "CUSTOM_SERVICE",
            description: "Changed package",
            quantity: 1,
            unitPrice: 1
          }
        ]
      }
    }),
    { code: "CRM_QUOTE_PRICE_LOCKED" }
  );

  assert.equal(approved.quote.status, CRM_QUOTE_STATUS.APPROVED);
  assert.equal(sent.quote.status, CRM_QUOTE_STATUS.SENT);
  assert.equal(sent.quote.total, 195);
  assert.ok(sent.quote.priceLockedAt);
});

test("accepting a CRM quote does not create booking or accounting revenue", async () => {
  const { service, state } = createHarness();
  const created = await service.createQuote({ payload: baseQuotePayload() });
  await service.approveQuote({ quoteId: created.quote.id });
  await service.sendQuote({ quoteId: created.quote.id });
  const accepted = await service.acceptQuote({ quoteId: created.quote.id });

  assert.equal(accepted.action, "accepted");
  assert.equal(accepted.bookingCreated, false);
  assert.equal(accepted.quote.status, CRM_QUOTE_STATUS.ACCEPTED);
  assert.equal(accepted.quote.convertedBookingId, null);
  assert.equal(state.audits.some((audit) => audit.action === "crm_quote_accepted"), true);
  assert.equal(state.audits.find((audit) => audit.action === "crm_quote_accepted").metadata.bookingCreated, false);
});

test("converts an accepted quote only by linking an existing confirmed Bokun booking", async () => {
  const { service, state } = createHarness();
  const opportunityId = state.opportunities[0]._id;
  const created = await service.createQuote({
    payload: baseQuotePayload({ opportunityId })
  });
  await service.approveQuote({ quoteId: created.quote.id });
  await service.sendQuote({ quoteId: created.quote.id });
  await service.acceptQuote({ quoteId: created.quote.id });

  const converted = await service.convertQuoteToBooking({
    quoteId: created.quote.id,
    payload: {
      bookingReference: "ZNZ-CONFIRMED-1",
      conversionNote: "Customer completed website checkout and Bokun confirmed booking."
    }
  });

  assert.equal(converted.action, "converted");
  assert.equal(converted.bookingCreated, false);
  assert.equal(converted.quote.status, CRM_QUOTE_STATUS.CONVERTED);
  assert.equal(String(converted.quote.convertedBookingId), state.bookings[0]._id);
  assert.equal(converted.quote.bokunBookingId, "BKN-CONFIRMED-1");
  assert.equal(converted.opportunity.stage, CRM_OPPORTUNITY_STAGE.WON);
  assert.equal(String(converted.opportunity.wonBookingId), state.bookings[0]._id);
  assert.equal(converted.opportunity.wonBokunBookingId, "BKN-CONFIRMED-1");
  assert.equal(state.audits.some((audit) => audit.action === "crm_quote_converted_to_booking"), true);
  assert.equal(state.audits.some((audit) => audit.action === "crm_opportunity_won_from_quote_conversion"), true);
  assert.equal(state.timeline.some((event) => event.eventType === "BOOKING_LINKED"), true);
});

test("quote conversion is idempotent for an already converted quote", async () => {
  const { service } = createHarness();
  const created = await service.createQuote({ payload: baseQuotePayload() });
  await service.approveQuote({ quoteId: created.quote.id });
  await service.sendQuote({ quoteId: created.quote.id });
  await service.acceptQuote({ quoteId: created.quote.id });

  const converted = await service.convertQuoteToBooking({
    quoteId: created.quote.id,
    payload: { bookingReference: "ZNZ-CONFIRMED-1" }
  });
  const repeated = await service.convertQuoteToBooking({
    quoteId: created.quote.id,
    payload: { bokunBookingId: "BKN-CONFIRMED-1" }
  });

  assert.equal(converted.action, "converted");
  assert.equal(repeated.action, "existing");
  assert.equal(repeated.quote.status, CRM_QUOTE_STATUS.CONVERTED);
  assert.equal(String(repeated.quote.convertedBookingId), String(converted.quote.convertedBookingId));
});

test("quote conversion rejects unaccepted quotes and unconfirmed Bokun bookings", async () => {
  const { service } = createHarness();
  const created = await service.createQuote({ payload: baseQuotePayload() });

  await assert.rejects(
    () => service.convertQuoteToBooking({
      quoteId: created.quote.id,
      payload: { bookingReference: "ZNZ-CONFIRMED-1" }
    }),
    { code: "CRM_QUOTE_CONVERSION_REQUIRES_ACCEPTED" }
  );

  await service.approveQuote({ quoteId: created.quote.id });
  await service.sendQuote({ quoteId: created.quote.id });
  await service.acceptQuote({ quoteId: created.quote.id });

  await assert.rejects(
    () => service.convertQuoteToBooking({
      quoteId: created.quote.id,
      payload: { bookingReference: "ZNZ-PENDING-1" }
    }),
    { code: "CRM_BOOKING_CONFIRMATION_REQUIRED" }
  );
});

test("quote dashboard metrics keep quote value separate from actual revenue", async () => {
  const { service } = createHarness();
  const sentQuote = await service.createQuote({ payload: baseQuotePayload() });
  await service.approveQuote({ quoteId: sentQuote.quote.id });
  await service.sendQuote({ quoteId: sentQuote.quote.id });

  const acceptedQuote = await service.createQuote({
    payload: baseQuotePayload({
      lineItems: [
        {
          itemType: "TRANSFER",
          description: "Airport transfer",
          quantity: 1,
          unitPrice: 80
        }
      ]
    })
  });
  await service.approveQuote({ quoteId: acceptedQuote.quote.id });
  await service.sendQuote({ quoteId: acceptedQuote.quote.id });
  await service.acceptQuote({ quoteId: acceptedQuote.quote.id });

  const metrics = await service.getQuoteDashboardMetrics();

  assert.equal(metrics.quoteCount, 2);
  assert.equal(metrics.sentQuoteCount, 1);
  assert.equal(metrics.acceptedQuoteCount, 1);
  assert.equal(metrics.totalQuotedValue, 275);
  assert.equal(metrics.sentQuoteValue, 195);
  assert.equal(metrics.acceptedQuoteValue, 80);
  assert.equal(metrics.quoteValueIsForecastOnly, true);
});

test("new quotes cannot skip into sent or accepted status", async () => {
  const { service } = createHarness();

  await assert.rejects(
    () => service.createQuote({
      payload: baseQuotePayload({ status: CRM_QUOTE_STATUS.ACCEPTED })
    }),
    { code: "CRM_QUOTE_INITIAL_STATUS_INVALID" }
  );
});
