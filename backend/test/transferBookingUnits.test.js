const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REFERENCE_PATTERN,
  generateBookingReference,
  bookingAccessToken,
  tokenMatches,
  requestFingerprint,
  maskEmail,
  maskPhone
} = require("../src/transfers/security/bookingAccess");
const { zanzibarInstant, publicBookingView } = require("../src/transfers/services/bookings");

test("booking references are random, readable and match the published format", () => {
  const references = new Set(Array.from({ length: 2000 }, () => generateBookingReference()));
  assert.equal(references.size, 2000);
  for (const reference of references) assert.match(reference, REFERENCE_PATTERN);
  assert.equal([...references].some((reference) => /[01ILO]/.test(reference.slice(4))), false);
});

test("access tokens are derived per booking and never equal across bookings, nonces or secrets", () => {
  const base = { secret: "s".repeat(40), bookingId: "b1", nonce: "n1" };
  const token = bookingAccessToken(base);
  assert.equal(token, bookingAccessToken(base));
  assert.ok(token.length >= 40);
  assert.notEqual(token, bookingAccessToken({ ...base, bookingId: "b2" }));
  assert.notEqual(token, bookingAccessToken({ ...base, nonce: "n2" }));
  assert.notEqual(token, bookingAccessToken({ ...base, secret: "t".repeat(40) }));
  assert.equal(tokenMatches(token, token), true);
  assert.equal(tokenMatches(`${token}x`, token), false);
  assert.equal(tokenMatches("", ""), false);
  assert.equal(tokenMatches(undefined, token), false);
});

test("the idempotency fingerprint ignores key order but not values", () => {
  assert.equal(requestFingerprint({ a: 1, b: { c: 2, d: 3 } }), requestFingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(requestFingerprint({ a: 1 }), requestFingerprint({ a: 2 }));
});

test("contact details are masked on public views", () => {
  assert.equal(maskEmail("jane.doe@example.com"), "j******@example.com");
  assert.equal(maskEmail("a@b.co"), "a**@b.co");
  assert.equal(maskEmail("not-an-email"), "");
  assert.equal(maskPhone("+255 712 345 678"), "+•••••••••678");
  assert.equal(maskPhone("12"), "");
});

test("Zanzibar local times are stored as the right UTC instant and impossible dates are rejected", () => {
  assert.equal(zanzibarInstant("2026-12-01", "09:30").toISOString(), "2026-12-01T06:30:00.000Z");
  assert.equal(zanzibarInstant("2026-12-01", "01:15").toISOString(), "2026-11-30T22:15:00.000Z");
  assert.equal(zanzibarInstant("2026-02-30", "10:00"), null);
  assert.equal(zanzibarInstant("2026-12-01", "24:00"), null);
  assert.equal(zanzibarInstant("01/12/2026", "10:00"), null);
});

test("the public booking view exposes no internal ids, tokens or full contact details", () => {
  const view = publicBookingView({
    _id: "secret-id",
    reference: "TRF-ABCDEFGH",
    status: "AWAITING_PAYMENT",
    paymentStatus: "UNPAID",
    tripType: "ONE_WAY",
    accessNonce: "nonce",
    idempotencyKey: "key",
    requestFingerprint: "fp",
    legs: [{ direction: "OUTBOUND", pickupLocationId: "l1", routeId: "r1", rateId: "t1", pickupLocationName: "Airport", dropoffLocationName: "Hotel", localDate: "2026-12-01", localTime: "09:30", price: "45" }],
    passengers: { adults: 2, children: 0, infants: 0, priced: 2, capacity: 2 },
    customer: { fullName: "Jane Doe", email: "jane@example.com", phone: "+255712345678", whatsapp: true },
    pricing: { status: "PRICED", currency: "USD", total: "45", basis: "PER_VEHICLE" },
    statusHistory: [{ status: "AWAITING_PAYMENT", at: new Date(), by: "customer", note: "internal note" }]
  });
  const json = JSON.stringify(view);
  for (const hidden of ["secret-id", "nonce", "\"key\"", "fp", "l1", "r1", "t1", "jane@example.com", "+255712345678", "internal note"]) {
    assert.equal(json.includes(hidden), false, hidden);
  }
  assert.equal(view.pricing.total, "45.00");
  assert.equal(view.legs[0].price, "45.00");
  assert.equal(view.customer.fullName, "Jane Doe");
});

test("the booking horizon is a setting, two years by default", () => {
  const { scheduleFor } = require("../src/transfers/services/bookings");
  const now = new Date("2026-10-11T00:00:00Z");
  const input = (date) => ({ tripType: "ONE_WAY", travelDate: date, travelTime: "10:00" });
  assert.ok(scheduleFor(input("2028-10-01"), now).outbound);
  assert.throws(() => scheduleFor(input("2028-10-20"), now), /up to 730 days ahead/);
  assert.throws(() => scheduleFor(input("2026-11-20"), now, 30), /up to 30 days ahead/);
  assert.ok(scheduleFor(input("2026-11-01"), now, 30).outbound);
});

test("flight numbers accept real airline formats", () => {
  const { FLIGHT_NUMBER_PATTERN } = require("../src/transfers/validators");
  for (const valid of ["PW 1234", "KQ-488", "TK0605", "5H123", "ET815A", "QR 1349", "ATC123"]) assert.ok(FLIGHT_NUMBER_PATTERN.test(valid), valid);
  for (const invalid of ["HELLO", "-PW1", "PW  12", "A", "ABCDEFGHIJKLM1", "PW_12"]) assert.equal(FLIGHT_NUMBER_PATTERN.test(invalid), false, invalid);
});
