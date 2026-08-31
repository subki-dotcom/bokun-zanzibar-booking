process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/bokun-confirmed-import-test";
process.env.JWT_SECRET ||= "bokun-confirmed-import-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const bokunService = require("../src/services/bokun");
const {
  mapBokunBookingForImport
} = require("../src/integrations/bokun/confirmedBooking.mapper");
const {
  createBokunConfirmedBookingImportService
} = require("../src/services/bokunConfirmedBookings");

const clone = (value) => JSON.parse(JSON.stringify(value));

const confirmedBooking = (overrides = {}) => ({
  booking: {
    bookingId: "BOKUN-1001",
    id: "BOKUN-1001",
    confirmationCode: "CONF-1001",
    externalBookingReference: "VTR-1001",
    externalBookingEntityCode: "VIATOR-CHANNEL",
    creationDate: "2026-08-01T07:15:00.000Z",
    confirmationDate: "2026-08-01T07:25:00.000Z",
    lastModifiedAt: "2026-08-03T11:45:00.000Z",
    status: "CONFIRMED",
    currency: "USD",
    totalPrice: 100,
    totalPaid: 100,
    paidType: "PAID",
    channel: { title: "Viator" },
    customer: {
      firstName: "Asha",
      lastName: "Traveler",
      email: "asha@example.com",
      phoneNumber: "+255700000001",
      country: "TZ"
    },
    activityBookings: [
      {
        productId: "PROD-1",
        title: "Stone Town Tour",
        rateId: "OPT-1",
        rateTitle: "Morning",
        date: "2026-09-12",
        startTime: "09:30",
        pickupDateTime: "2026-09-12T05:45:00.000Z",
        endTime: "12:30",
        product: { id: "PROD-1", title: "Stone Town Tour" },
        pricingCategoryBookings: [
          {
            pricingCategoryId: "adult",
            quantity: 2,
            pricingCategory: { id: "adult", title: "Adult", ticketCategory: "ADULT" }
          }
        ]
      }
    ],
    ...overrides
  }
});

const createFakeModels = ({ bookings = [] } = {}) => {
  const state = {
    bookings: bookings.map(clone),
    customers: [],
    audits: [],
    syncLogs: []
  };

  const wrapBooking = (row) => ({
    ...row,
    save: async function save() {
      const index = state.bookings.findIndex((booking) => booking._id === this._id);
      const plain = clone({ ...this, save: undefined });
      if (index >= 0) state.bookings[index] = plain;
      else state.bookings.push(plain);
      return this;
    }
  });

  const matchesBookingQuery = (booking, query = {}) => {
    const clauses = query.$or || [query];
    return clauses.some((clause) =>
      Object.entries(clause).every(([key, value]) => String(booking[key] || "") === String(value || ""))
    );
  };

  const BookingModel = {
    findOne: async (query) => {
      const found = state.bookings.find((booking) => matchesBookingQuery(booking, query));
      return found ? wrapBooking(clone(found)) : null;
    },
    create: async (payload) => {
      const row = {
        _id: `booking-${state.bookings.length + 1}`,
        ...clone(payload)
      };
      state.bookings.push(row);
      return wrapBooking(clone(row));
    }
  };

  const CustomerModel = {
    findOne: async ({ email }) => {
      const found = state.customers.find((customer) => customer.email === email);
      if (!found) return null;
      return {
        ...found,
        save: async function save() {
          const index = state.customers.findIndex((customer) => customer._id === this._id);
          state.customers[index] = clone({ ...this, save: undefined });
          return this;
        }
      };
    },
    create: async (payload) => {
      const row = {
        _id: `customer-${state.customers.length + 1}`,
        ...clone(payload)
      };
      state.customers.push(row);
      return {
        ...row,
        save: async function save() {
          const index = state.customers.findIndex((customer) => customer._id === this._id);
          state.customers[index] = clone({ ...this, save: undefined });
          return this;
        }
      };
    }
  };

  const SyncLogModel = {
    create: async (payload) => {
      const row = {
        _id: `sync-${state.syncLogs.length + 1}`,
        ...clone(payload),
        save: async function save() {
          const index = state.syncLogs.findIndex((log) => log._id === this._id);
          state.syncLogs[index] = clone({ ...this, save: undefined });
          return this;
        }
      };
      state.syncLogs.push(row);
      return row;
    }
  };

  const AuditLogModel = {
    create: async (payload) => {
      state.audits.push(clone(payload));
      return payload;
    }
  };

  return { state, BookingModel, CustomerModel, SyncLogModel, AuditLogModel };
};

const createHarness = ({ bookings = [], lookupBooking } = {}) => {
  const models = createFakeModels({ bookings });
  const bokun = {
    searchBookings: async () => ({
      page: 1,
      pageSize: 10,
      totalCount: 1,
      items: [{ confirmationCode: "CONF-1001" }]
    }),
    lookupBooking: lookupBooking || (async () => ({
      bokunBookingId: "BOKUN-1001",
      bookingReference: "VTR-1001",
      confirmationCode: "CONF-1001",
      status: "CONFIRMED",
      raw: confirmedBooking()
    }))
  };
  const service = createBokunConfirmedBookingImportService({
    ...models,
    bokun,
    now: () => new Date("2026-08-08T08:00:00.000Z")
  });
  return { ...models, service };
};

test("builds Bokun booking-search payload with documented pagination, statuses, and date range", () => {
  const payload = bokunService.__testables.buildBookingSearchPayload({
    page: 2,
    pageSize: 75,
    bookingStatuses: ["confirmed", "cancelled"],
    dateRangeField: "lastModifiedDateRange",
    fromDate: "2026-08-01T00:00:00.000Z",
    toDate: "2026-08-08T00:00:00.000Z"
  });

  assert.equal(payload.page, 2);
  assert.equal(payload.pageSize, 75);
  assert.deepEqual(payload.bookingStatuses, ["CONFIRMED", "CANCELLED"]);
  assert.deepEqual(payload.lastModifiedDateRange, {
    from: "2026-08-01T00:00:00.000Z",
    includeLower: true,
    to: "2026-08-08T00:00:00.000Z",
    includeUpper: true
  });
});

test("normalizes local booking status names to Bokun booking-search status tokens", () => {
  assert.deepEqual(
    bokunService.__testables.normalizeBookingSearchStatuses(["confirmed", "cancelled", "CONFIRMED"]),
    ["CONFIRMED", "CANCELLED"]
  );
  assert.deepEqual(
    bokunService.__testables.normalizeBookingSearchStatuses("pending,voided"),
    ["PENDING", "VOIDED"]
  );
});

test("retries transient Bokun read failures without retrying permanent failures", async () => {
  const attempts = [];
  const result = await bokunService.__testables.withBokunReadRetry(
    async (attempt) => {
      attempts.push(attempt);
      if (attempt < 2) {
        const error = new Error("temporary timeout");
        error.code = "BOKUN_TIMEOUT";
        error.statusCode = 504;
        throw error;
      }
      return "ok";
    },
    { maxRetries: 2, delayMs: 0, operationName: "test-read" }
  );

  assert.equal(result, "ok");
  assert.deepEqual(attempts, [0, 1, 2]);

  await assert.rejects(
    () => bokunService.__testables.withBokunReadRetry(
      async () => {
        const error = new Error("bad request");
        error.code = "BOKUN_REQUEST_FAILED";
        error.statusCode = 400;
        throw error;
      },
      { maxRetries: 2, delayMs: 0, operationName: "test-read" }
    ),
    /bad request/
  );
});

test("maps only confirmed Bokun bookings as importable and preserves raw channel evidence", () => {
  const mapped = mapBokunBookingForImport({
    bokunBooking: {
      raw: confirmedBooking()
    }
  });

  assert.equal(mapped.status.rawStatus, "CONFIRMED");
  assert.equal(mapped.status.normalizedStatus, "confirmed");
  assert.equal(mapped.isImportableConfirmed, true);
  assert.equal(mapped.snapshot.salesChannel, "VIATOR");
  assert.equal(mapped.snapshot.bookingReference, "VTR-1001");
  assert.equal(mapped.snapshot.bokunExternalBookingReference, "VTR-1001");
  assert.equal(mapped.snapshot.rawChannelSource, "Viator");
  assert.equal(mapped.snapshot.externalChannelReference, "VIATOR-CHANNEL");
  assert.equal(mapped.snapshot.travelDate, "2026-09-12");
  assert.equal(mapped.snapshot.startTime, "09:30");
  assert.equal(mapped.snapshot.bokunOperationalDates.timezone, "Africa/Dar_es_Salaam");
  assert.equal(mapped.snapshot.bokunOperationalDates.bookingCreatedAtBokun.raw, "2026-08-01T07:15:00.000Z");
  assert.equal(mapped.snapshot.bokunOperationalDates.bookingCreatedAtBokun.localDate, "2026-08-01");
  assert.equal(mapped.snapshot.bokunOperationalDates.bookingCreatedAtBokun.localTime, "10:15");
  assert.equal(mapped.snapshot.bokunOperationalDates.travelDate.raw, "2026-09-12");
  assert.equal(mapped.snapshot.bokunOperationalDates.travelDate.localDate, "2026-09-12");
  assert.equal(mapped.snapshot.bokunOperationalDates.travelDate.localTime, "");
  assert.equal(mapped.snapshot.bokunOperationalDates.activityStartTime.raw, "09:30");
  assert.equal(mapped.snapshot.bokunOperationalDates.activityStartTime.localTime, "09:30");
  assert.equal(mapped.snapshot.paxSummary.adults, 2);
});

test("keeps unavailable Bokun operational dates empty instead of inventing local timestamps", () => {
  const mapped = mapBokunBookingForImport({
    bokunBooking: {
      raw: confirmedBooking({
        creationDate: undefined,
        confirmationDate: undefined,
        lastModifiedAt: undefined
      })
    }
  });

  assert.equal(mapped.snapshot.bokunOperationalDates.bookingCreatedAtBokun.raw, "");
  assert.equal(mapped.snapshot.bokunOperationalDates.bookingCreatedAtBokun.normalizedAt, null);
  assert.equal(mapped.snapshot.bokunOperationalDates.bookingCreatedAtBokun.localDate, "");
  assert.equal(mapped.snapshot.bokunOperationalDates.bookingCreatedAtBokun.localTime, "");
  assert.equal(mapped.snapshot.bokunOperationalDates.bookingConfirmedAtBokun.raw, "");
  assert.equal(mapped.snapshot.bokunOperationalDates.bokunLastModifiedAt.raw, "");
});

test("does not import ambiguous or unconfirmed Bokun statuses", () => {
  const mapped = mapBokunBookingForImport({
    bokunBooking: {
      raw: confirmedBooking({ status: "WAITING_FOR_SUPPLIER" })
    }
  });

  assert.equal(mapped.status.normalizedStatus, "unknown");
  assert.equal(mapped.isImportableConfirmed, false);
});

test("imports confirmed Bokun booking once and repeated sync is idempotent", async () => {
  const harness = createHarness();

  const first = await harness.service.syncConfirmedBookings({
    requestId: "sync-1",
    pageSize: 10,
    maxPages: 1
  });
  const second = await harness.service.syncConfirmedBookings({
    requestId: "sync-2",
    pageSize: 10,
    maxPages: 1
  });

  assert.equal(first.summary.imported, 1);
  assert.equal(second.summary.unchanged, 1);
  assert.equal(harness.state.bookings.length, 1);
  assert.equal(harness.state.bookings[0].operationalSource, "BOKUN");
  assert.equal(harness.state.bookings[0].salesChannel, "VIATOR");
  assert.equal(harness.state.bookings[0].bokunExternalBookingReference, "VTR-1001");
  assert.equal(harness.state.bookings[0].rawChannelSource, "Viator");
  assert.equal(harness.state.bookings[0].externalChannelReference, "VIATOR-CHANNEL");
  assert.equal(harness.state.bookings[0].bokunOperationalDates.travelDate.localDate, "2026-09-12");
  assert.equal(harness.state.bookings[0].bokunOperationalDates.activityStartTime.localTime, "09:30");
  assert.equal(harness.state.syncLogs.length, 2);
  assert.equal(harness.state.audits.length, 1);
});

test("single resync synchronizes Bokun cancellation only for an existing local booking", async () => {
  const harness = createHarness({
    bookings: [
      {
        _id: "booking-existing",
        bookingReference: "VTR-1001",
        bokunBookingId: "BOKUN-1001",
        bokunConfirmationCode: "CONF-1001",
        bookingStatus: "confirmed",
        paymentStatus: "paid",
        sourceChannel: "viator",
        salesChannel: "VIATOR",
        customer: {},
        bokunImport: {}
      }
    ],
    lookupBooking: async () => ({
      raw: confirmedBooking({ status: "CANCELLED", cancellationDate: "2026-08-07T10:00:00.000Z" })
    })
  });

  const result = await harness.service.manualResync({
    reference: "CONF-1001",
    requestId: "cancel-sync"
  });

  assert.equal(result.result.action, "cancelled");
  assert.equal(harness.state.bookings[0].bookingStatus, "cancelled");
  assert.equal(harness.state.bookings[0].paymentStatus, "paid");
  assert.equal(harness.state.bookings[0].cancellation.cancelledBy, "bokun_import");
  assert.equal(harness.state.bookings[0].bokunOperationalDates.cancellationDate.raw, "2026-08-07T10:00:00.000Z");
  assert.equal(new Date(harness.state.bookings[0].cancellation.cancelledAt).toISOString(), "2026-08-07T10:00:00.000Z");
});

test("existing paid direct website booking keeps local financial truth while linking to Bokun", async () => {
  const harness = createHarness({
    bookings: [
      {
        _id: "booking-direct",
        bookingReference: "VTR-1001",
        bokunBookingId: "",
        bokunConfirmationCode: "",
        bookingStatus: "pending",
        paymentStatus: "paid",
        paymentTransactionId: "pesapal-1",
        sourceChannel: "direct_website",
        amount: 1,
        currency: "USD",
        pricingSnapshot: { finalPayable: 1, currency: "USD" },
        customer: {},
        bokunImport: {}
      }
    ]
  });

  await harness.service.manualResync({
    reference: "CONF-1001",
    requestId: "direct-link"
  });

  assert.equal(harness.state.bookings.length, 1);
  assert.equal(harness.state.bookings[0].operationalSource, "BOKUN");
  assert.equal(harness.state.bookings[0].salesChannel, "DIRECT_WEBSITE");
  assert.equal(harness.state.bookings[0].bookingStatus, "confirmed");
  assert.equal(harness.state.bookings[0].paymentStatus, "paid");
  assert.equal(harness.state.bookings[0].amount, 1);
  assert.equal(harness.state.bookings[0].pricingSnapshot.finalPayable, 1);
});
