process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/unused-confirmation-test";
process.env.JWT_SECRET ||= "supplier-confirmation-test-secret";
process.env.BOKUN_MOCK_MODE = "true";
process.env.PESAPAL_MOCK_MODE = "true";
process.env.DPO_MOCK_MODE = "true";
process.env.PAYPAL_MOCK_MODE = "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const mapper = require("../src/integrations/bokun/bokun.mapper");
const client = require("../src/integrations/bokun/bokun.client");
const bokun = require("../src/services/bokun");
const { normalizeBokunBookingStatus } = require("../src/integrations/bokun/bookingStatus.adapter");

for (const status of [undefined, "", "UNKNOWN", "UNCONFIRMED", "SUCCESS", "PENDING", "RESERVED", "REJECTED", "CANCELLED", "TIMEOUT"]) {
  test("supplier status " + String(status) + " cannot confirm an ID-only response", () => {
    const raw = { booking: { id: 123, ...(status === undefined ? {} : { status }) } };
    const mapped = mapper.mapBookingResponse(raw);
    assert.notEqual(mapped.status, "CONFIRMED");
    assert.equal(normalizeBokunBookingStatus(mapped).operationallyConfirmed, false);
    assert.equal(mapped.bokunBookingId, 123);
    assert.deepEqual(mapped.raw, raw);
  });
}

test("explicit authoritative confirmation still maps correctly", () => {
  const mapped = mapper.mapBookingResponse({ booking: { id: 123, status: "CONFIRMED" } });
  assert.equal(mapped.status, "CONFIRMED");
  assert.equal(normalizeBokunBookingStatus(mapped).operationallyConfirmed, true);
});

test("an envelope status cannot confirm a nested booking with no status", () => {
  assert.equal(normalizeBokunBookingStatus({ status: "CONFIRMED", booking: { id: 123 } }).operationallyConfirmed, false);
});

const payload = {
  productId: "101", optionId: "201", travelDate: "2026-12-01",
  priceCategoryParticipants: [{ categoryId: "301", quantity: 1 }],
  customer: { firstName: "Fixture", lastName: "Guest", email: "guest@example.test" },
  amount: 100, currency: "USD", externalBookingReference: "FIXTURE-1"
};

for (const status of [undefined, "UNKNOWN", "PENDING", "REJECTED", "CANCELLED"]) {
  test("checkout does not confirm-reserved for " + String(status), async (t) => {
    const calls = [];
    t.mock.method(client, "request", async (request) => {
      calls.push(request);
      return { booking: { id: 123, confirmationCode: "SUPPLIER-123", status } };
    });
    const result = await bokun.createBooking(payload, "fixture");
    assert.equal(calls.length, 1);
    assert.notEqual(result.status, "CONFIRMED");
    assert.equal(calls[0].retry, false);
  });
}

test("reserve then confirm keeps reservation evidence before a confirmation timeout", async (t) => {
  const evidence = [];
  const requests = [];
  t.mock.method(client, "request", async (request) => {
    requests.push(request);
    if (requests.length === 1) return { booking: { id: 123, confirmationCode: "SUPPLIER-123", status: "RESERVED" } };
    assert.equal(evidence[0].bokunBookingId, 123);
    throw Object.assign(new Error("Supplier timeout"), { code: "BOKUN_TIMEOUT", statusCode: 504 });
  });
  await assert.rejects(bokun.createBooking(payload, "fixture", { onSupplierResponse: async (response) => evidence.push(response) }), { code: "BOKUN_TIMEOUT" });
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.retry === false));
  assert.equal(evidence[0].status, "RESERVED");
});

const bookings = require("../src/services/bookings");
const Booking = require("../src/models/Booking");
const Customer = require("../src/models/Customer");
const Product = require("../src/models/ProductSnapshot");
const Audit = require("../src/models/AuditLog");
const payments = require("../src/services/payments");
const invoices = require("../src/services/invoices");
const offers = require("../src/services/offers");
const notifications = require("../src/services/notifications");
const sync = require("../src/services/webhooks");
const pesapal = require("../src/services/payments/pesapal");

const get = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const set = (object, path, value, remove = false) => {
  const keys = path.split(".");
  const last = keys.pop();
  let target = object;
  for (const key of keys) target = target[key] ||= {};
  if (remove) delete target[last];
  else target[last] = structuredClone(value);
};
const matches = (state, query) => Object.entries(query).every(([key, expected]) => {
  if (key === "$or") return expected.some((item) => matches(state, item));
  if (key === "$and") return expected.every((item) => matches(state, item));
  const actual = get(state, key);
  if (expected && typeof expected === "object") {
    if ("$exists" in expected) return (actual !== undefined) === expected.$exists;
    if ("$lte" in expected) return actual <= expected.$lte;
    if ("$gt" in expected) return actual > expected.$gt;
    if ("$ne" in expected) return actual !== expected.$ne;
    if ("$nin" in expected) return !expected.$nin.includes(actual);
  }
  return expected === null ? actual == null : actual === expected;
});

const harness = (t, overrides = {}) => {
  const state = {
    _id: "fixture-booking", __v: 0, bookingReference: "FIXTURE-1", bokunProductId: "101",
    bookingStatus: "pending", supplierStatus: "supplier_pending", paymentStatus: "paid",
    amount: 100, currency: "USD", pricingSnapshot: { finalPayable: 100, amountPaid: 100 },
    invoiceSnapshot: { paymentStatus: "paid", amountPaid: 100, total: 100 },
    estimatedCostSnapshot: { total: 30 },
    bokunFinancialEvidence: { status: "VERIFIED", evidenceHash: "existing-evidence" },
    customer: payload.customer,
    pendingCheckout: { checkoutPayload: { ...payload, pax: { adults: 1 } }, finalization: { status: "idle" } },
    ...structuredClone(overrides)
  };
  const doc = () => {
    const copy = structuredClone(state);
    Object.defineProperties(copy, {
      toObject: { value: () => structuredClone({ ...copy }) },
      save: { value: async () => { Object.assign(state, structuredClone({ ...copy })); return copy; } }
    });
    return copy;
  };
  const update = (filter, patch) => {
    if (!matches(state, filter)) return false;
    for (const [key, value] of Object.entries(patch.$set || {})) set(state, key, value);
    for (const key of Object.keys(patch.$unset || {})) set(state, key, null, true);
    for (const [key, value] of Object.entries(patch.$inc || {})) set(state, key, (get(state, key) || 0) + value);
    for (const [key, value] of Object.entries(patch.$push || {})) set(state, key, [...(get(state, key) || []), value]);
    return true;
  };
  t.mock.method(Booking, "findById", async () => doc());
  t.mock.method(Booking, "findOneAndUpdate", async (filter, patch) => update(filter, patch) ? doc() : null);
  t.mock.method(Booking, "updateOne", async (filter, patch) => ({ matchedCount: update(filter, patch) ? 1 : 0 }));
  t.mock.method(Product, "findOne", () => ({ lean: async () => ({ title: "Fixture tour", options: [{ bokunOptionId: "201", name: "Standard" }] }) }));
  t.mock.method(Customer, "findOne", async () => ({ _id: "fixture-customer", ...payload.customer, bookings: [state._id], save: async () => {} }));
  t.mock.method(Audit, "create", async () => ({}));
  t.mock.method(payments, "assertBokunFinalizationEligibility", async () => ({ amount: 100 }));
  t.mock.method(payments, "getVerifiedPaidAmountByBookingReference", async () => 100);
  const paymentSync = t.mock.method(payments, "updatePaymentBokunSyncStatus", async () => {});
  t.mock.method(payments, "linkAllocationsToInvoice", async () => {});
  t.mock.method(invoices, "buildInvoiceSnapshot", async () => structuredClone(state.invoiceSnapshot));
  t.mock.method(invoices, "upsertInvoiceFromSnapshot", async () => ({ _id: "fixture-invoice" }));
  t.mock.method(offers, "resolveApplicableOffer", async () => ({ discountAmount: 0, subsidyAmount: 0, finalAmount: 100 }));
  t.mock.method(bokun, "fetchAvailability", async () => ({ available: true, priceCategories: [{ categoryId: "301", title: "Adult" }], pricing: { currency: "USD", grossAmount: 100, baseAmount: 100 } }));
  t.mock.method(bokun, "resolveBookingQuestions", async () => ({ missing: [], questions: [], bookingQuestions: [] }));
  const notified = t.mock.method(notifications, "notifyBookingConfirmed", async () => {});
  const reconcile = t.mock.method(sync, "reconcileExistingBokunBooking", async () => ({ found: false, booking: doc() }));
  return { state, doc, notified, reconcile, paymentSync, finalize: () => bookings.finalizePendingBookingAfterPayment({ bookingId: state._id, requestId: "fixture" }) };
};

for (const [status, local, finalization] of [
  [undefined, "pending", "failed"], ["UNKNOWN", "pending", "failed"],
  ["PENDING", "pending", "pending_retry"], ["RESERVED", "pending", "pending_retry"],
  ["REJECTED", "failed", "failed"], ["CANCELLED", "cancelled", "failed"]
]) {
  test("paid finalization stays unconfirmed for " + String(status) + " and retains supplier evidence", async (t) => {
    const h = harness(t);
    const raw = { booking: { id: 123, status, customer: { email: "private@example.test" } } };
    const create = t.mock.method(bokun, "createBooking", async () => mapper.mapBookingResponse(raw));
    const oldEvidence = structuredClone(h.state.bokunFinancialEvidence);
    await assert.rejects(h.finalize());
    assert.equal(h.state.bookingStatus, local);
    assert.equal(h.state.pendingCheckout.finalization.status, finalization);
    assert.equal(h.state.paymentStatus, "paid");
    assert.equal(h.state.invoiceSnapshot.amountPaid, 100);
    assert.deepEqual(h.state.bokunFinancialEvidence, oldEvidence);
    assert.equal(h.state.bokunBookingId, "123");
    assert.deepEqual(h.state.rawBokunResponse, raw);
    assert.equal(h.notified.mock.callCount(), 0);
    assert.ok(h.paymentSync.mock.calls.every((call) => call.arguments[0].status !== "confirmed"));
    await assert.rejects(h.finalize());
    assert.equal(create.mock.callCount(), 1, "retry must never resubmit an existing supplier booking");
  });
}

test("confirmed creation finalizes once and a duplicate callback preserves the result", async (t) => {
  const h = harness(t);
  const create = t.mock.method(bokun, "createBooking", async () => mapper.mapBookingResponse({ booking: { id: 123, status: "CONFIRMED" } }));
  const result = await h.finalize();
  assert.equal(result.response.bookingStatus, "confirmed");
  assert.equal(h.state.supplierStatus, "confirmed");
  assert.equal(h.state.pendingCheckout.finalization.status, "confirmed");
  assert.equal(h.notified.mock.callCount(), 1);
  await h.finalize();
  assert.equal(create.mock.callCount(), 1);
  assert.equal(h.state.paymentStatus, "paid");
});

test("timeout after a supplier write never triggers a second creation, even on forced retry", async (t) => {
  const h = harness(t);
  const create = t.mock.method(bokun, "createBooking", async () => { throw Object.assign(new Error("Gateway timeout"), { statusCode: 504, code: "BOKUN_TIMEOUT" }); });
  await assert.rejects(h.finalize());
  await assert.rejects(bookings.finalizePendingBookingAfterPayment({ bookingId: h.state._id, force: true }));
  assert.equal(create.mock.callCount(), 1);
  assert.equal(h.state.paymentStatus, "paid");
  assert.equal(h.state.bookingStatus, "pending");
  assert.equal(h.notified.mock.callCount(), 0);
});

test("a historical confirmed booking is returned unchanged without supplier calls", async (t) => {
  const h = harness(t, { bookingStatus: "confirmed", bokunBookingId: "historical-1", supplierStatus: "confirmed", pendingCheckout: {} });
  const before = structuredClone(h.state);
  const create = t.mock.method(bokun, "createBooking", async () => { throw new Error("Must not create"); });
  const result = await h.finalize();
  assert.equal(result.response.bookingStatus, "confirmed");
  assert.deepEqual(h.state, before);
  assert.equal(create.mock.callCount(), 0);
});

test("paid supplier-pending status remains PAID in the customer response despite an ID", async (t) => {
  const h = harness(t, { bokunBookingId: "123" });
  const result = await pesapal.__testables.buildCustomerPaymentStatus({ booking: h.doc(), status: "paid_pending_finalization" });
  assert.equal(result.publicStatus, "PAID");
  assert.equal(result.bookingStatus, "paid_supplier_pending");
  assert.notEqual(result.bokunSyncStatus, "synced");
});

for (const [status, expected] of [["CONFIRMED", "confirmed"], [undefined, "pending"], ["UNCONFIRMED", "pending"], ["SUCCESS", "pending"], ["COMPLETED", "pending"], ["RESERVED", "pending"], ["REJECTED", "failed"], ["CANCELLED", "cancelled"]]) {
  test("authoritative reconciliation maps " + String(status) + " without confirmation inference", async (t) => {
    const h = harness(t, { bokunBookingId: "123" });
    h.reconcile.mock.restore();
    t.mock.method(require("../src/services/bookingPayment/sync"), "syncBokunPayment", async () => ({ changed: false }));
    t.mock.method(bokun, "lookupBooking", async () => ({ ...mapper.mapBookingResponse({ booking: { id: 123, status } }), status: "CONFIRMED" }));
    const result = await sync.reconcileExistingBokunBooking({ bookingDoc: h.doc(), requestId: "fixture" });
    assert.equal(result.found, true);
    assert.equal(h.state.bookingStatus, expected);
    assert.equal(h.state.paymentStatus, "paid");
    assert.equal(h.state.bokunFinancialEvidence.evidenceHash, "existing-evidence");
  });
}

test("unknown reconciliation response preserves a historical confirmed booking", async (t) => {
  const h = harness(t, { bookingStatus: "confirmed", supplierStatus: "confirmed", bokunBookingId: "123" });
  h.reconcile.mock.restore();
  t.mock.method(require("../src/services/bookingPayment/sync"), "syncBokunPayment", async () => ({ changed: false }));
  t.mock.method(bokun, "lookupBooking", async () => mapper.mapBookingResponse({ booking: { id: 123 } }));
  await sync.reconcileExistingBokunBooking({ bookingDoc: h.doc() });
  assert.equal(h.state.bookingStatus, "confirmed");
  assert.equal(h.state.supplierStatus, "confirmed");
});

test("pending supplier booking becomes confirmed on authoritative lookup without another creation", async (t) => {
  const h = harness(t, { bokunBookingId: "123" });
  h.reconcile.mock.restore();
  t.mock.method(require("../src/services/bookingPayment/sync"), "syncBokunPayment", async () => ({ changed: false }));
  t.mock.method(bokun, "lookupBooking", async () => mapper.mapBookingResponse({ booking: { id: 123, status: "CONFIRMED" } }));
  const create = t.mock.method(bokun, "createBooking", async () => { throw new Error("Must not create"); });
  const result = await h.finalize();
  assert.equal(result.response.bookingStatus, "confirmed");
  assert.equal(h.state.pendingCheckout.finalization.status, "confirmed");
  assert.equal(h.notified.mock.callCount(), 1);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(h.state.paymentStatus, "paid");
});

for (const status of [undefined, "UNCONFIRMED", "PENDING"]) {
  test("finding supplier ID with " + String(status) + " does not complete a retry", async (t) => {
    const h = harness(t, { bokunBookingId: "123" });
    h.reconcile.mock.restore();
    t.mock.method(require("../src/services/bookingPayment/sync"), "syncBokunPayment", async () => ({ changed: false }));
    t.mock.method(bokun, "lookupBooking", async () => mapper.mapBookingResponse({ booking: { id: 123, status } }));
    const create = t.mock.method(bokun, "createBooking", async () => { throw new Error("Must not create"); });
    await assert.rejects(h.finalize());
    assert.notEqual(h.state.pendingCheckout.finalization.status, "confirmed");
    assert.equal(h.state.bookingStatus, "pending");
    assert.equal(create.mock.callCount(), 0);
    assert.equal(h.notified.mock.callCount(), 0);
  });
}

test("a timeout without a supplier ID reconciles by exact external reference", async (t) => {
  const h = harness(t);
  h.state.pendingCheckout.finalization.supplierRequestStartedAt = "2026-10-01T00:00:00.000Z";
  h.reconcile.mock.restore();
  t.mock.method(require("../src/services/bookingPayment/sync"), "syncBokunPayment", async () => ({ changed: false }));
  const lookup = t.mock.method(bokun, "lookupBooking", async () => { throw new Error("A local reference is not a supplier ID"); });
  const search = t.mock.method(bokun, "findBookingByExternalReference", async (reference) => {
    assert.equal(reference, h.state.bookingReference);
    return mapper.mapBookingResponse({ booking: { id: 123, status: "CONFIRMED", externalBookingReference: reference } });
  });
  const create = t.mock.method(bokun, "createBooking", async () => { throw new Error("Must not resubmit"); });
  await h.finalize();
  assert.equal(h.state.bookingStatus, "confirmed");
  assert.equal(search.mock.callCount(), 1);
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal(create.mock.callCount(), 0);
});

test("simultaneous finalization callbacks submit exactly one supplier booking", async (t) => {
  const h = harness(t);
  let started, release;
  const entered = new Promise((resolve) => { started = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const create = t.mock.method(bokun, "createBooking", async () => {
    started();
    await blocked;
    return mapper.mapBookingResponse({ booking: { id: 123, status: "CONFIRMED" } });
  });
  const first = h.finalize();
  await entered;
  try {
    await assert.rejects(h.finalize(), { code: "BOOKING_FINALIZATION_IN_PROGRESS" });
  } finally { release(); }
  await first;
  assert.equal(create.mock.callCount(), 1);
  assert.equal(h.state.bookingStatus, "confirmed");
});

test("the reservation is persisted before confirm timeout and payment evidence remains intact", async (t) => {
  const h = harness(t);
  let calls = 0;
  t.mock.method(client, "request", async () => {
    calls += 1;
    if (calls === 1) return { booking: { id: 123, status: "RESERVED", confirmationCode: "SUPPLIER-123" } };
    assert.equal(h.state.bokunBookingId, "123");
    assert.equal(h.state.rawBokunResponse.booking.status, "RESERVED");
    throw Object.assign(new Error("Supplier timed out"), { code: "BOKUN_TIMEOUT", statusCode: 504 });
  });
  await assert.rejects(h.finalize());
  assert.equal(calls, 2);
  assert.equal(h.state.bokunConfirmationCode, "SUPPLIER-123");
  assert.equal(h.state.bookingStatus, "pending");
  assert.equal(h.state.paymentStatus, "paid");
  assert.equal(h.state.pendingCheckout.finalization.supplierResponses.length, 1);
  const customerResult = await pesapal.__testables.buildCustomerPaymentStatus({ booking: h.doc(), status: "paid_pending_finalization" });
  assert.equal(customerResult.publicStatus, "PAID");
  assert.equal(JSON.stringify(customerResult).includes("supplierResponses"), false);
});

test("payment verification never promotes a pending supplier ID to confirmed", async (t) => {
  const h = harness(t, { paymentStatus: "pending", bokunBookingId: "123" });
  await bookings.markBookingPaymentVerified({ bookingId: h.state._id, amountPaid: 100, currency: "USD" });
  assert.equal(h.state.paymentStatus, "paid");
  assert.equal(h.state.bookingStatus, "pending");
  assert.equal(h.state.supplierStatus, "supplier_pending");
  assert.notEqual(h.state.pendingCheckout.finalization.status, "confirmed");
});

test("pending finalization query includes a paid booking with a supplier ID", () => {
  const query = bookings.__testables.buildPendingFinalizationQuery();
  assert.equal(matches({ paymentStatus: "paid", bookingStatus: "pending", bokunBookingId: "123", pendingCheckout: { checkoutPayload: {}, finalization: { status: "pending_retry" } } }, query), true);
  assert.equal(matches({ paymentStatus: "paid", bookingStatus: "confirmed", bokunBookingId: "123", pendingCheckout: { checkoutPayload: {} } }, query), false);
});

for (const raw of [null, {}, { booking: { status: "CONFIRMED" } }]) {
  test("ambiguous response " + JSON.stringify(raw) + " cannot finalize", async (t) => {
    const h = harness(t);
    t.mock.method(bokun, "createBooking", async () => mapper.mapBookingResponse(raw));
    await assert.rejects(h.finalize(), { code: "BOKUN_SUPPLIER_CONFIRMATION_REVIEW" });
    assert.equal(h.state.bookingStatus, "pending");
    assert.equal(h.state.paymentStatus, "paid");
    assert.equal(h.notified.mock.callCount(), 0);
  });
}

test("payload variants cannot replay a timed-out creation", async (t) => {
  const h = harness(t);
  Object.assign(h.state.pendingCheckout.checkoutPayload, { startTime: "09:00", startTimeId: "401" });
  t.mock.method(bokun, "fetchAvailability", async () => ({ available: true, slots: [{ time: "09:00", startTimeId: "401", status: "available" }], priceCategories: [{ categoryId: "301" }], pricing: { grossAmount: 100, currency: "USD" } }));
  const create = t.mock.method(bokun, "createBooking", async () => { throw Object.assign(new Error("Gateway timeout"), { statusCode: 504 }); });
  await assert.rejects(h.finalize());
  assert.equal(create.mock.callCount(), 1);
});

test("confirm response can reuse a persisted reservation ID without inferring its status", async (t) => {
  const h = harness(t);
  let calls = 0;
  t.mock.method(client, "request", async () => ++calls === 1
    ? { booking: { id: 123, status: "RESERVED", confirmationCode: "SUPPLIER-123" } }
    : { booking: { status: "CONFIRMED", confirmationCode: "SUPPLIER-123" } });
  const result = await h.finalize();
  assert.equal(result.response.bookingStatus, "confirmed");
  assert.equal(result.response.bokunBookingId, "123");
  assert.equal(h.state.pendingCheckout.finalization.supplierResponses.length, 2);
});

test("stale-lock takeover cannot submit another booking while an earlier request is in flight", async (t) => {
  const h = harness(t);
  let started, release;
  const entered = new Promise((resolve) => { started = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const create = t.mock.method(bokun, "createBooking", async () => {
    started(); await blocked;
    return mapper.mapBookingResponse({ booking: { id: 123, status: "CONFIRMED" } });
  });
  const first = h.finalize();
  await entered;
  h.state.pendingCheckout.finalization.lockedAt = "2000-01-01T00:00:00.000Z";
  try {
    await assert.rejects(h.finalize(), { code: "BOKUN_SUPPLIER_OUTCOME_UNKNOWN" });
  } finally { release(); }
  await assert.rejects(first, { code: "BOKUN_SUPPLIER_OUTCOME_UNKNOWN" });
  assert.equal(create.mock.callCount(), 1);
  assert.equal(h.state.paymentStatus, "paid");
  assert.notEqual(h.state.bookingStatus, "confirmed");
  assert.equal(h.state.pendingCheckout.finalization.supplierResponses[0].raw.booking.id, 123);
});

test("an ancillary notification failure cannot downgrade explicit supplier confirmation", async (t) => {
  const h = harness(t);
  t.mock.method(bokun, "createBooking", async () => mapper.mapBookingResponse({ booking: { id: 123, status: "CONFIRMED" } }));
  t.mock.method(notifications, "notifyBookingConfirmed", async () => { throw new Error("Fixture notification unavailable"); });
  await assert.rejects(h.finalize(), /Fixture notification unavailable/);
  assert.equal(h.state.bookingStatus, "confirmed");
  assert.equal(h.state.supplierStatus, "confirmed");
  assert.equal(h.state.pendingCheckout.finalization.status, "confirmed");
  assert.equal(h.state.paymentStatus, "paid");
});

for (const provider of ["dpo", "paypal"]) {
  test(provider + " cannot tell a paid customer their pending supplier ID is confirmed", async (t) => {
    const h = harness(t, { bokunBookingId: "123" });
    const service = require("../src/services/payments/" + provider);
    const result = await service.createPayment({ payload: { bookingId: h.state._id }, requestId: "fixture" });
    assert.equal(result.bookingStatus, "pending");
    assert.equal(result.paymentStatus, "paid");
    assert.match(result.message, /Supplier confirmation is still pending/);
    const cancel = await service.handlePaymentCancel({ bookingId: h.state._id, requestId: "fixture" });
    assert.equal(cancel.status, "paid");
    assert.match(cancel.message, /Supplier confirmation is still pending/);
  });
}

test("a stale checkout snapshot cannot erase the no-resubmit guard", async (t) => {
  const h = harness(t);
  const before = structuredClone(h.state.pendingCheckout);
  const create = t.mock.method(bokun, "createBooking", async () => { throw Object.assign(new Error("Gateway timeout"), { code: "BOKUN_TIMEOUT", statusCode: 504 }); });
  await assert.rejects(h.finalize());
  assert.ok(h.state.bokunSubmissionStartedAt);
  h.state.pendingCheckout = before;
  await assert.rejects(h.finalize(), { code: "BOKUN_SUPPLIER_OUTCOME_UNKNOWN" });
  assert.equal(create.mock.callCount(), 1);
  assert.equal(Booking.schema.path("bokunSubmissionStartedAt").instance, "Date");
});

for (const response of [{ status: "CONFIRMED", raw: null }, { status: "CONFIRMED", booking: null }]) {
  test("malformed authoritative evidence cannot fall back to wrapper confirmation " + JSON.stringify(response), () => {
    assert.equal(normalizeBokunBookingStatus(response).operationallyConfirmed, false);
  });
}

test("Pesapal reuses a paid booking without inferring supplier confirmation or requiring a new checkout", async (t) => {
  const h = harness(t, { bokunBookingId: "123", pendingCheckout: {} });
  const result = await pesapal.createPayment({ payload: { bookingId: h.state._id }, requestId: "fixture" });
  assert.equal(result.paymentStatus, "paid");
  assert.equal(result.bookingStatus, "pending");
  assert.match(result.message, /Supplier confirmation is still processing/);
});

for (const race of ['takeover','cancellation','expired','payment-reversed']) {
  test('final confirmation rejects '+race+' after supplier evidence was persisted', async(t)=>{
    const h=harness(t);
    const customerWrite=t.mock.method(Customer,'findOne',async()=>{ throw new Error('Customer effects ran before ownership transition'); });
    t.mock.method(bokun,'createBooking',async(_payload,_requestId,{onSupplierResponse})=>{
      const response=mapper.mapBookingResponse({booking:{id:123,status:'CONFIRMED'}});
      await onSupplierResponse(response);
      if(race==='takeover') h.state.pendingCheckout.finalization.lockToken='replacement-owner';
      if(race==='cancellation') {h.state.bookingStatus='cancelled';h.state.cancellation={cancelledAt:new Date()};}
      if(race==='expired') h.state.pendingCheckout.finalization.lockedAt='2000-01-01T00:00:00.000Z';
      if(race==='payment-reversed') h.state.paymentStatus='reversed';
      return response;
    });
    await assert.rejects(h.finalize(),{code:'BOKUN_SUPPLIER_OUTCOME_UNKNOWN'});
    assert.notEqual(h.state.bookingStatus,'confirmed');
    if(race==='cancellation') assert.equal(h.state.bookingStatus,'cancelled');
    if(race==='takeover') assert.equal(h.state.pendingCheckout.finalization.lockToken,'replacement-owner');
    if(race==='payment-reversed') assert.equal(h.state.paymentStatus,'reversed');
    assert.equal(h.notified.mock.callCount(),0);
    assert.equal(customerWrite.mock.callCount(),0);
    assert.equal(h.paymentSync.mock.calls.some(c=>c.arguments[0].status==='confirmed'),false);
  });
}

test('zero-match confirmation write is a conflict and has no confirmation effects',async(t)=>{
 const h=harness(t);
 const update=Booking.findOneAndUpdate;
 t.mock.method(Booking,'findOneAndUpdate',async(filter,patch,...args)=>patch.$set?.bookingStatus==='confirmed'?null:update(filter,patch,...args));
 t.mock.method(bokun,'createBooking',async()=>mapper.mapBookingResponse({booking:{id:123,status:'CONFIRMED'}}));
 await assert.rejects(h.finalize(),{code:'BOKUN_SUPPLIER_OUTCOME_UNKNOWN'});
 assert.notEqual(h.state.bookingStatus,'confirmed');
 assert.equal(h.notified.mock.callCount(),0);
 assert.equal(invoices.upsertInvoiceFromSnapshot.mock.callCount(),0);
});

for (const race of ['takeover','cancellation','expired']) {
 test('atomic final write rejects '+race+' after the last response check',async(t)=>{
  const h=harness(t);
  const update=Booking.findOneAndUpdate;
  t.mock.method(Booking,'findOneAndUpdate',async(filter,patch,...args)=>{
   if(patch.$set?.bookingStatus==='confirmed') {
    if(race==='takeover') h.state.pendingCheckout.finalization.lockToken='new-owner';
    if(race==='cancellation') h.state.bookingStatus='cancelled';
    if(race==='expired') h.state.pendingCheckout.finalization.lockedAt='2000-01-01T00:00:00.000Z';
   }
   return update(filter,patch,...args);
  });
  t.mock.method(bokun,'createBooking',async()=>mapper.mapBookingResponse({booking:{id:123,status:'CONFIRMED'}}));
  await assert.rejects(h.finalize(),{code:'BOKUN_SUPPLIER_OUTCOME_UNKNOWN'});
  assert.notEqual(h.state.bookingStatus,'confirmed');
  assert.equal(h.notified.mock.callCount(),0);
  assert.equal(invoices.upsertInvoiceFromSnapshot.mock.callCount(),0);
  if(race==='takeover') assert.equal(h.state.pendingCheckout.finalization.lockToken,'new-owner');
 });
 test('reconciliation rejects '+race+' during supplier lookup',async(t)=>{
  const h=harness(t,{bokunBookingId:'123'}); h.reconcile.mock.restore();
  t.mock.method(bokun,'lookupBooking',async()=>{
   if(race==='takeover') h.state.pendingCheckout.finalization.lockToken='new-owner';
   if(race==='cancellation') h.state.bookingStatus='cancelled';
   if(race==='expired') h.state.pendingCheckout.finalization.lockedAt='2000-01-01T00:00:00.000Z';
   return mapper.mapBookingResponse({booking:{id:123,status:'CONFIRMED'}});
  });
  await assert.rejects(h.finalize(),{code:'BOKUN_SUPPLIER_OUTCOME_UNKNOWN'});
  assert.notEqual(h.state.bookingStatus,'confirmed');
  assert.equal(h.notified.mock.callCount(),0);
  if(race==='takeover') assert.equal(h.state.pendingCheckout.finalization.lockToken,'new-owner');
 });
}

test('isolated MongoDB enforces finalization ownership and payment initiation CAS', {
 skip: process.env.RUN_PHASE1B_MONGO !== '1', timeout: 60000
}, async(t)=>{
 const fs=require('node:fs/promises'); const path=require('node:path'); const os=require('node:os');
 const net=require('node:net'); const {spawn}=require('node:child_process'); const mongoose=require('mongoose');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'phase1b-mongo-'));
 const server=net.createServer(); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port; await new Promise(resolve=>server.close(resolve));
 const child=spawn(process.env.MONGOD_BINARY || 'mongod',['--dbpath',directory,'--bind_ip','127.0.0.1','--port',String(port),'--logpath',path.join(directory,'mongod.log')],{windowsHide:true,stdio:'ignore'});
 let spawnError; child.on('error',error=>{spawnError=error;});
 let connection;
 try {
  for(let attempt=0;attempt<60;attempt++) {
   if(spawnError) throw spawnError;
   try {connection=await mongoose.createConnection('mongodb://127.0.0.1:'+port+'/phase1b_isolated',{serverSelectionTimeoutMS:300,autoIndex:false}).asPromise();break;}
   catch(error){if(attempt===59)throw error;await new Promise(r=>setTimeout(r,100));}
  }
  const RealBooking=connection.model('Phase1BBooking',Booking.schema.clone(),'fixture_bookings');
  for(const scenario of ['owner','takeover','cancelled','expired','reversed','concurrent','reconcile-owner','reconcile-takeover','reconcile-cancelled']) {
   await t.test('real MongoDB '+scenario,async(st)=>{
    const h=harness(st);
    const id=new mongoose.Types.ObjectId(); const customerId=new mongoose.Types.ObjectId();
    h.state._id=id;h.state.customer.customerId=customerId;h.state.bookingReference='MONGO-'+scenario;
    if(scenario.startsWith('reconcile')) h.state.bokunBookingId='123';
    await RealBooking.collection.insertOne(h.state);
    for(const method of ['findById','findOneAndUpdate','updateOne']) st.mock.method(Booking,method,(...args)=>RealBooking[method](...args));
    st.mock.method(Customer,'findOne',async()=>({_id:customerId,...payload.customer,bookings:[id],save:async()=>{}}));
    let entered,release;const started=new Promise(r=>{entered=r;});const blocked=new Promise(r=>{release=r;});
    const create=st.mock.method(bokun,'createBooking',async(_p,_r,{onSupplierResponse})=>{
      const response=mapper.mapBookingResponse({booking:{id:123,status:'CONFIRMED'}});
      await onSupplierResponse(response);
      if(scenario==='takeover') await RealBooking.updateOne({_id:id},{$set:{'pendingCheckout.finalization.lockToken':'replacement'}});
      if(scenario==='cancelled') await RealBooking.updateOne({_id:id},{$set:{bookingStatus:'cancelled'}});
      if(scenario==='expired') await RealBooking.updateOne({_id:id},{$set:{'pendingCheckout.finalization.lockedAt':'2000-01-01T00:00:00.000Z'}});
      if(scenario==='reversed') await RealBooking.updateOne({_id:id},{$set:{paymentStatus:'reversed'}});
      if(scenario==='concurrent'){entered();await blocked;}
      return response;
    });
    if(scenario.startsWith('reconcile')) {
      h.reconcile.mock.restore();
      st.mock.method(require('../src/services/bookingPayment/sync'),'syncBokunPayment',async()=>({changed:false}));
      st.mock.method(bokun,'lookupBooking',async()=>{
        if(scenario==='reconcile-takeover') await RealBooking.updateOne({_id:id},{$set:{'pendingCheckout.finalization.lockToken':'replacement'}});
        if(scenario==='reconcile-cancelled') await RealBooking.updateOne({_id:id},{$set:{bookingStatus:'cancelled'}});
        return mapper.mapBookingResponse({booking:{id:123,status:'CONFIRMED'}});
      });
    }
    if(['owner','reconcile-owner'].includes(scenario)) await h.finalize();
    else if(scenario==='concurrent') {
      const first=h.finalize();await started;
      try{await assert.rejects(h.finalize(),{code:'BOOKING_FINALIZATION_IN_PROGRESS'});}finally{release();}
      await first; assert.equal(create.mock.callCount(),1);
    } else await assert.rejects(h.finalize(),{code:'BOKUN_SUPPLIER_OUTCOME_UNKNOWN'});
    const stored=await RealBooking.findById(id).lean();
    assert.equal(stored.bookingStatus,['owner','concurrent','reconcile-owner'].includes(scenario)?'confirmed':scenario.endsWith('cancelled')?'cancelled':'pending');
    assert.equal(stored.paymentStatus,scenario==='reversed'?'reversed':'paid');
    if(scenario.endsWith('takeover')) assert.equal(stored.pendingCheckout.finalization.lockToken,'replacement');
    assert.equal(h.notified.mock.callCount(),['owner','concurrent','reconcile-owner'].includes(scenario)?1:0);
   });
  }
  await t.test('real MongoDB serializes payment initiation and preserves concurrent paid state',async(st)=>{
   const guard=require('../src/services/payments/initiationGuard');
   const id=new mongoose.Types.ObjectId();
   await RealBooking.collection.insertOne({_id:id,bookingReference:'MONGO-PAYMENT',paymentStatus:'pending',bookingStatus:'pending',amount:100,currency:'USD'});
   for(const method of ['findById','findOneAndUpdate','updateOne']) st.mock.method(Booking,method,(...args)=>RealBooking[method](...args));
   st.mock.method(payments,'findLatestPaymentByBookingReference',async()=>null);
   const booking=await RealBooking.findById(id);
   const results=await Promise.allSettled([guard.claim({booking,provider:'dpo'}),guard.claim({booking,provider:'paypal'})]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   const owned=results.find(r=>r.status==='fulfilled').value;
   await RealBooking.updateOne({_id:id},{$set:{paymentStatus:'paid'}});
   const persisted=await guard.persist({booking:owned.booking,token:owned.token,fields:{paymentStatus:'pending'},checkout:{},response:{redirectUrl:'https://fixture.invalid/pay'}});
   assert.equal(persisted.response.paymentStatus,'paid');assert.equal(persisted.response.redirectUrl,'');
   assert.equal((await RealBooking.findById(id)).paymentStatus,'paid');
  });
 } finally {
  if(connection) await connection.close();
  if(child.exitCode===null && !spawnError) { const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited; }
  const resolved=path.resolve(directory);
  assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('phase1b-mongo-'));
  await fs.rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});
 }
});

test('ambiguous prior submission without an ownership conflict remains marked for review',async(t)=>{
 const h=harness(t,{bokunSubmissionStartedAt:new Date()});
 await assert.rejects(h.finalize(),{code:'BOKUN_SUPPLIER_OUTCOME_UNKNOWN'});
 assert.equal(h.state.pendingCheckout.finalization.status,'failed');
 assert.equal(h.state.pendingCheckout.finalization.lockToken,undefined);
 assert.equal(h.state.paymentStatus,'paid');
});

test('supplier cancellation response is retained and completed as review, never confirmation',async(t)=>{
 const h=harness(t);
 t.mock.method(client,'request',async()=>({booking:{id:123,status:'CANCELLED'}}));
 await assert.rejects(h.finalize(),{code:'BOKUN_SUPPLIER_CONFIRMATION_REVIEW'});
 assert.equal(h.state.bookingStatus,'cancelled');
 assert.equal(h.state.pendingCheckout.finalization.status,'failed');
 assert.equal(h.state.paymentStatus,'paid');
 assert.equal(h.notified.mock.callCount(),0);
});
