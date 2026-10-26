const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/services/myBooking/core");
const view = require("../src/services/myBooking/view");

test("new references are random, ZNZ- plus 8 unambiguous characters", () => {
  const seen = new Set();
  for (let index = 0; index < 2000; index += 1) {
    const reference = core.buildBookingReference();
    assert.match(reference, /^ZNZ-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    seen.add(reference);
  }
  assert.equal(seen.size, 2000);
  assert.ok(!/[01OIL]/.test(core.REFERENCE_ALPHABET));
});

test("secrets are long, random and stored hashed", () => {
  const token = core.randomSecret();
  assert.ok(Buffer.from(token, "base64url").length >= 16);
  assert.notEqual(core.hashSecret(token), token);
  assert.equal(core.hashSecret(token), core.hashSecret(token));
  assert.equal(core.hashSecret(token).length, 64);
});

test("personal data is masked", () => {
  assert.equal(core.maskName("amani", "Bakari"), "A•••• B••••");
  assert.equal(core.maskEmail("amani@email.com"), "a•••@email.com");
  assert.equal(core.maskPhone("+255 778 775 123"), "+••• ••• ••• 123");
  assert.equal(core.maskPhone(""), "");
});

test("the CSRF token is bound to its session and the QR code holds no personal data", () => {
  assert.notEqual(core.csrfTokenFor("a", "s"), core.csrfTokenFor("b", "s"));
  const code = core.ticketCode("znz-7f3k9q2m", "secret");
  assert.match(code, /^RISER:ZNZ-7F3K9Q2M:[A-Za-z0-9_-]{12}$/);
});

test("references are normalised and old timestamp references are still accepted", () => {
  assert.equal(core.normalizeReference(" znz-1792697901720-4881 "), "ZNZ-1792697901720-4881");
  assert.ok(core.isPlausibleReference("ZNZ-1792697901720-4881"));
  assert.ok(core.isPlausibleReference("ZNZ-7F3K9Q2M"));
  assert.ok(!core.isPlausibleReference("x"));
});

const NOW = Date.parse("2026-10-27T09:00:00Z");
const baseBooking = {
  bookingReference: "ZNZ-7F3K9Q2M",
  productTitle: "Zanzibar Transfers",
  optionTitle: "Nungwi hotel to Nungwi hotels",
  travelDate: "2026-11-30",
  startTime: "09:00",
  paymentStatus: "paid",
  bookingStatus: "confirmed",
  paxSummary: { adults: 1 },
  pricingSnapshot: { finalPayable: 40, currency: "USD" },
  invoiceSnapshot: { amountPaid: 40, balanceDue: 0 },
  customer: { firstName: "Amani", lastName: "Bakari", email: "amani@email.com", phone: "+255778775123", hotelName: "Nungwi Beach Resort" }
};
const freePolicy = { deadline: "2026-11-29T09:00:00+03:00", isFreeCancellationAvailable: true, refundable: true, amountPaid: 40, estimatedRefundAmount: 40, estimatedCancellationFee: 0 };

test("dashboard: masked lead traveler, no full email, phone or supplier codes", () => {
  const data = view.buildDashboard({ booking: { ...baseBooking, bokunBookingId: "BOKUN-1", bokunConfirmationCode: "SUP-9" }, policy: freePolicy, now: NOW });
  const json = JSON.stringify(data);
  assert.equal(data.lead.name, "A•••• B••••");
  for (const secret of ["amani@email.com", "778775123", "Amani", "Bakari", "BOKUN-1", "SUP-9", "okun"]) assert.ok(!json.includes(secret), secret);
  assert.equal(data.status.label, "Confirmed · Paid in full");
  assert.equal(data.daysToGo, 34);
  assert.equal(data.policy.refundLine, "Full refund if cancelled before Sun, 29 Nov, 09:00");
  assert.deepEqual(data.timeline.map((row) => row.time), ["day_before", "08:50", "09:00"]);
});

test("dashboard statuses map the real booking states", () => {
  const state = (booking, requests = [], now = NOW) => view.buildDashboard({ booking: { ...baseBooking, ...booking }, requests, policy: freePolicy, now }).status.key;
  assert.equal(state({ paymentStatus: "pending", bookingStatus: "pending" }), "pending_payment");
  assert.equal(state({ bookingStatus: "pending" }), "paid");
  assert.equal(state({ bookingStatus: "cancelled" }), "cancelled");
  assert.equal(state({}, [{ type: "cancel_booking", status: "submitted" }]), "cancellation_requested");
  assert.equal(state({}, [{ type: "reschedule", status: "under_review" }]), "change_requested");
  assert.equal(state({}, [], Date.parse("2026-12-02T09:00:00Z")), "completed");
});

test("actions close after the deadline, on completed and cancelled bookings, with a reason", () => {
  const afterDeadline = view.buildDashboard({ booking: baseBooking, policy: { ...freePolicy, isFreeCancellationAvailable: false }, now: Date.parse("2026-11-29T10:00:00Z") });
  assert.equal(afterDeadline.actions.changeDate.allowed, false);
  assert.match(afterDeadline.actions.changeDate.reason, /Changes closed/);
  assert.equal(afterDeadline.actions.cancel.allowed, true);
  const cancelled = view.buildDashboard({ booking: { ...baseBooking, bookingStatus: "cancelled" }, policy: freePolicy, now: NOW });
  assert.equal(cancelled.actions.cancel.allowed, false);
  assert.equal(cancelled.actions.cancel.reason, "This booking is cancelled.");
  const completed = view.buildDashboard({ booking: baseBooking, policy: freePolicy, now: Date.parse("2026-12-05T10:00:00Z") });
  assert.equal(completed.phase, "past");
  assert.equal(completed.actions.changeTravelers.allowed, false);
});

test("trip phases use the Zanzibar calendar day", () => {
  // 22:30 UTC on the 29th is already the 30th in Zanzibar.
  assert.deepEqual(view.tripPhase("2026-11-30", Date.parse("2026-11-29T22:30:00Z")), { phase: "today", daysToGo: 0 });
  assert.equal(view.tripPhase("2026-11-30", Date.parse("2026-11-30T21:30:00Z")).phase, "past");
});

test("drop-off time comes from the product duration and is hidden when unknown", () => {
  const withDuration = view.buildDashboard({ booking: baseBooking, product: { duration: "1 hour" }, policy: freePolicy, now: NOW });
  assert.equal(withDuration.timeline.at(-1).time, "10:00");
  const without = view.buildDashboard({ booking: baseBooking, product: { duration: "" }, policy: freePolicy, now: NOW });
  assert.ok(!without.timeline.some((row) => row.key === "end"));
});
