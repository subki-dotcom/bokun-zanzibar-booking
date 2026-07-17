const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/legacy-recovery-test";
process.env.JWT_SECRET ||= "legacy-recovery-test-secret";

const {
  RECOVERY_ERROR_CLASSIFICATION,
  buildLegacyRecoveryCandidateQuery,
  classifyBokunFinalizationError,
  createLegacyBokunRecoveryService,
  evaluateLegacyRecoveryEligibility
} = require("../src/services/bookings/legacyBokunRecovery.service");

const fixedNow = new Date("2026-07-17T08:00:00.000Z");

const clone = (value) => JSON.parse(JSON.stringify(value));

const getPath = (target, path) =>
  path.split(".").reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), target);

const setPath = (target, path, value) => {
  const keys = path.split(".");
  const lastKey = keys.pop();
  const parent = keys.reduce((value, key) => {
    if (!value[key] || typeof value[key] !== "object") value[key] = {};
    return value[key];
  }, target);
  parent[lastKey] = value;
};

const unsetPath = (target, path) => {
  const keys = path.split(".");
  const lastKey = keys.pop();
  const parent = keys.reduce((value, key) => (value && value[key] ? value[key] : null), target);
  if (parent) delete parent[lastKey];
};

const createBooking = (overrides = {}) => ({
  _id: "booking-1",
  bookingReference: "ZNZ-LEGACY-1",
  paymentStatus: "paid",
  bookingStatus: "pending",
  paymentMethod: "pesapal",
  paymentTransactionId: "tracking-1",
  bokunBookingId: "",
  bokunConfirmationCode: "",
  travelDate: "2026-07-31",
  invoiceSnapshot: { paymentStatus: "paid", amountPaid: 80 },
  pendingCheckout: {
    finalization: {
      status: "failed",
      finalizationPending: false,
      attemptCount: 1,
      lastError: {
        code: "BOKUN_REQUEST_FAILED",
        statusCode: 422,
        message: "Missing pricingCategoryId (Field: passengers[0].pricingCategoryId)"
      }
    },
    checkoutPayload: { productId: "1" }
  },
  ...overrides
});

const createFakeModels = (seedBooking) => {
  const state = { booking: clone(seedBooking), audits: [] };
  const BookingModel = {
    findById: async (id) => (String(id) === String(state.booking._id) ? clone(state.booking) : null),
    findOneAndUpdate: async (query, update) => {
      if (String(query._id) !== String(state.booking._id)) return null;

      const expectedLock = query["legacyBokunRecovery.lockToken"];
      if (expectedLock !== undefined && getPath(state.booking, "legacyBokunRecovery.lockToken") !== expectedLock) {
        return null;
      }
      if (
        query.$and &&
        getPath(state.booking, "legacyBokunRecovery.lockToken") &&
        !query["legacyBokunRecovery.lockToken"]
      ) {
        return null;
      }

      Object.entries(update.$set || {}).forEach(([path, value]) => setPath(state.booking, path, clone(value)));
      Object.entries(update.$unset || {}).forEach(([path]) => unsetPath(state.booking, path));
      Object.entries(update.$inc || {}).forEach(([path, value]) =>
        setPath(state.booking, path, Number(getPath(state.booking, path) || 0) + Number(value || 0))
      );
      return clone(state.booking);
    }
  };
  const InvoiceModel = {
    findOne: async () => ({ paymentStatus: "paid", amountPaid: 80 })
  };
  const AuditLogModel = {
    create: async (event) => {
      state.audits.push(event);
      return event;
    }
  };
  return { state, BookingModel, InvoiceModel, AuditLogModel };
};

const createRecoveryHarness = ({ booking = createBooking(), lookupBooking, finalizeBooking } = {}) => {
  const { state, BookingModel, InvoiceModel, AuditLogModel } = createFakeModels(booking);
  const notifications = { sent: 0, notifyBookingConfirmed: async () => { notifications.sent += 1; } };
  const service = createLegacyBokunRecoveryService({
    BookingModel,
    InvoiceModel,
    AuditLogModel,
    now: () => fixedNow,
    createLockToken: () => "legacy-lock",
    payments: { getVerifiedPaidAmountByBookingReference: async () => 80 },
    bokun: {
      lookupBooking:
        lookupBooking ||
        (async () => {
          const error = new Error("Booking not found");
          error.statusCode = 404;
          throw error;
        })
    },
    notifications,
    loggerInstance: { error: () => {} }
  });
  return {
    service,
    state,
    notifications,
    finalizeBooking:
      finalizeBooking ||
      (async () => ({
        booking: { ...booking, bokunBookingId: "bokun-1", bookingStatus: "confirmed" },
        response: { bokunBookingId: "bokun-1" }
      }))
  };
};

test("classifies legacy pricing-category failures without relying on one exact message", () => {
  assert.equal(
    classifyBokunFinalizationError({ statusCode: 422, message: "pricing category is required" }),
    RECOVERY_ERROR_CLASSIFICATION.MISSING_PRICING_CATEGORY
  );
  assert.equal(
    classifyBokunFinalizationError({ statusCode: 422, message: "Invalid pricingCategoryId" }),
    RECOVERY_ERROR_CLASSIFICATION.INVALID_PRICING_CATEGORY
  );
  assert.equal(
    classifyBokunFinalizationError({ statusCode: 504, message: "Gateway timeout" }),
    RECOVERY_ERROR_CLASSIFICATION.TEMPORARY_PROVIDER_ERROR
  );
  assert.equal(
    classifyBokunFinalizationError({ statusCode: 401, message: "Unauthorized" }),
    RECOVERY_ERROR_CLASSIFICATION.AUTH_ERROR
  );
});

test("requires a paid invoice, verified payment, exhausted 422 pricing failure, and future travel date", () => {
  const eligible = evaluateLegacyRecoveryEligibility({
    booking: createBooking(),
    invoice: { paymentStatus: "paid", amountPaid: 80 },
    verifiedPaidAmount: 80,
    now: fixedNow
  });
  assert.equal(eligible.eligible, true);

  const unpaid = evaluateLegacyRecoveryEligibility({
    booking: createBooking(),
    invoice: { paymentStatus: "pending", amountPaid: 0 },
    verifiedPaidAmount: 80,
    now: fixedNow
  });
  assert.equal(unpaid.reason, "invoice_not_paid");

  const existing = evaluateLegacyRecoveryEligibility({
    booking: createBooking({ bokunBookingId: "already-created" }),
    invoice: { paymentStatus: "paid", amountPaid: 80 },
    verifiedPaidAmount: 80,
    now: fixedNow
  });
  assert.equal(existing.reason, "supplier_booking_exists");
});

test("candidate query is limited to exhausted 422 legacy bookings and excludes previous recovery results", () => {
  const query = buildLegacyRecoveryCandidateQuery({ now: fixedNow });
  assert.equal(query.paymentStatus, "paid");
  assert.equal(query.$and.some((clause) => clause["pendingCheckout.finalization.status"] === "failed"), true);
  assert.equal(query.$and.some((clause) => clause["pendingCheckout.finalization.lastError.statusCode"] === 422), true);
  assert.equal(query.$and.some((clause) => clause.travelDate?.$gte === "2026-07-17"), true);
  assert.equal(
    query.$and.some((clause) =>
      clause.$or?.some((alternative) => alternative["legacyBokunRecovery.status"]?.$exists === false)
    ),
    true
  );
});

test("rebuild recovery delegates to the current finalizer once and does not change payment records", async () => {
  let finalizerCalls = 0;
  const harness = createRecoveryHarness({
    finalizeBooking: async () => {
      finalizerCalls += 1;
      return { booking: { bokunBookingId: "bokun-1", bookingStatus: "confirmed" }, response: { bokunBookingId: "bokun-1" } };
    }
  });

  const result = await harness.service.recoverLegacyBooking({
    bookingId: "booking-1",
    requestId: "test-recovery",
    finalizeBooking: harness.finalizeBooking
  });

  assert.equal(result.status, "recovered");
  assert.equal(finalizerCalls, 1);
  assert.equal(harness.state.booking.paymentStatus, "paid");
  assert.equal(harness.state.audits.some((event) => event.action === "legacy_bokun_recovery_payload_rebuilt"), true);
});

test("existing Bókun booking is reconciled before create and confirmation notification is sent once", async () => {
  let finalizerCalls = 0;
  const harness = createRecoveryHarness({
    lookupBooking: async () => ({ bokunBookingId: "bokun-existing", confirmationCode: "CONF-1", status: "CONFIRMED" }),
    finalizeBooking: async () => {
      finalizerCalls += 1;
      return {};
    }
  });

  const first = await harness.service.recoverLegacyBooking({
    bookingId: "booking-1",
    finalizeBooking: harness.finalizeBooking
  });
  const second = await harness.service.recoverLegacyBooking({
    bookingId: "booking-1",
    finalizeBooking: harness.finalizeBooking
  });

  assert.equal(first.status, "reconciled");
  assert.equal(second.status, "skipped");
  assert.equal(finalizerCalls, 0);
  assert.equal(harness.notifications.sent, 1);
});

test("temporary provider failures are handed back to the normal retry flow, while permanent failures require review", async () => {
  const temporaryHarness = createRecoveryHarness({
    finalizeBooking: async () => {
      const error = new Error("Gateway timeout");
      error.statusCode = 504;
      throw error;
    }
  });
  const temporary = await temporaryHarness.service.recoverLegacyBooking({
    bookingId: "booking-1",
    finalizeBooking: temporaryHarness.finalizeBooking
  });
  assert.equal(temporary.status, "pending_retry");

  const permanentHarness = createRecoveryHarness({
    finalizeBooking: async () => {
      const error = new Error("Invalid pickup place");
      error.statusCode = 422;
      throw error;
    }
  });
  const permanent = await permanentHarness.service.recoverLegacyBooking({
    bookingId: "booking-1",
    finalizeBooking: permanentHarness.finalizeBooking
  });
  assert.equal(permanent.status, "manual_review_required");
});
