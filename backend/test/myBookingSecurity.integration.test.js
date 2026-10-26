// End-to-end security checks for guest "My booking" over HTTP, against an isolated throwaway database.
// Run with MY_BOOKING_TEST_MONGO_URI=mongodb://127.0.0.1:27018 (never the application database).
process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "my-booking-security-test-secret";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27018/unused";
process.env.FRONTEND_URL = "http://localhost:5173";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const mongoose = require("mongoose");

const MONGO = process.env.MY_BOOKING_TEST_MONGO_URI;
const skip = !MONGO;

const app = skip ? null : require("../src/app");
const Booking = require("../src/models/Booking");
const BookingAccessLink = require("../src/models/BookingAccessLink");
const AuditLog = require("../src/models/AuditLog");
const emailService = require("../src/services/email");
const { paymentAccessKey } = require("../src/services/payments/paymentRecoveryCore");
const core = require("../src/services/myBooking/core");

let server;
let base;
const sentLinks = [];

const request = async (method, path, { body, cookie = "", headers = {} } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost:5173", ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = Buffer.from(await response.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, json, raw, text: raw.toString("utf8") };
};

const makeBooking = (overrides = {}) =>
  Booking.create({
    bookingReference: core.buildBookingReference(),
    bokunProductId: "p-1",
    bokunOptionId: "o-1",
    productTitle: "Zanzibar Transfers",
    optionTitle: "Nungwi hotel to Nungwi hotels",
    travelDate: "2026-11-30",
    startTime: "09:00",
    amount: 40,
    currency: "USD",
    paymentStatus: "paid",
    bookingStatus: "confirmed",
    paxSummary: { adults: 1, children: 0, infants: 0 },
    pricingSnapshot: { finalPayable: 40, currency: "USD" },
    customer: { firstName: "Amani", lastName: "Bakari", email: "amani@example.test", phone: "+255778775123", hotelName: "Nungwi Beach Resort" },
    ...overrides
  });

const signIn = async (booking) => {
  sentLinks.length = 0;
  await request("POST", "/api/my-booking/lookup", { body: { reference: booking.bookingReference, email: booking.customer.email } });
  const url = sentLinks.at(-1);
  const token = decodeURIComponent(url.split("#token=")[1]);
  const opened = await request("POST", "/api/my-booking/session", { body: { token } });
  assert.equal(opened.status, 200);
  const cookie = opened.headers.get("set-cookie").split(";")[0];
  const session = await request("GET", "/api/my-booking/session", { cookie });
  return { cookie, csrf: session.json.data.csrfToken, token };
};

test.before(async () => {
  if (skip) return;
  await mongoose.connect(MONGO, { dbName: `my_booking_test_${process.pid}_${crypto.randomBytes(4).toString("hex")}`, serverSelectionTimeoutMS: 5000 });
  emailService.sendMyBookingLinkEmail = async ({ url }) => {
    sentLinks.push(url);
    return { sent: true };
  };
  emailService.sendMyBookingCodeEmail = async () => ({ sent: true });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (skip) return;
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("without a session no booking data, PII or actions are returned (404, not 403)", { skip }, async () => {
  const booking = await makeBooking();
  const paths = [
    `/api/my-booking/bookings/${booking.bookingReference}`,
    `/api/my-booking/bookings/${booking.bookingReference}/invoice`,
    `/api/my-booking/bookings/${booking.bookingReference}/ticket.pdf`,
    `/api/my-booking/bookings/${booking.bookingReference}/ticket-qr.svg`,
    `/api/my-booking/bookings/${booking.bookingReference}/cancellation-estimate`,
    // The old open endpoints.
    `/api/bookings/${booking.bookingReference}`,
    `/api/invoices/booking/${booking.bookingReference}`,
    `/api/bookings/${booking._id}/requests?customerEmail=amani@example.test`,
    `/api/bookings/${booking._id}/cancellation-estimate?customerEmail=amani@example.test`
  ];
  for (const path of paths) {
    const response = await request("GET", path);
    assert.equal(response.status, 404, path);
    assert.ok(!response.text.includes("amani@example.test") && !response.text.includes("Amani"), path);
  }
  const cancel = await request("POST", `/api/bookings/${booking._id}/requests`, {
    body: { customerEmail: "amani@example.test", type: "cancel_booking", customerReason: "Change of plans", cancellationConfirmed: true }
  });
  assert.equal(cancel.status, 404);
  const unknown = await request("GET", "/api/my-booking/bookings/ZNZ-NOTREAL1");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.error.code, cancel.json.error.code);
});

test("the payment link key still opens the old booking endpoint for that booking only", { skip }, async () => {
  const booking = await makeBooking();
  const other = await makeBooking();
  const key = paymentAccessKey(booking, process.env.JWT_SECRET);
  assert.equal((await request("GET", `/api/bookings/${booking.bookingReference}?key=${key}`)).status, 200);
  assert.equal((await request("GET", `/api/bookings/${other.bookingReference}?key=${key}`)).status, 404);
});

test("lookup always answers the same and only a match sends a link", { skip }, async () => {
  const booking = await makeBooking();
  sentLinks.length = 0;
  const attempts = [
    { reference: booking.bookingReference, email: "wrong@example.test" },
    { reference: "ZNZ-DOESNOT1", email: "amani@example.test" },
    { reference: booking.bookingReference, email: "AMANI@example.test" }
  ];
  const answers = [];
  for (const body of attempts) answers.push(await request("POST", "/api/my-booking/lookup", { body, headers: { "x-forwarded-for": `10.0.0.${answers.length + 1}` } }));
  for (const answer of answers) {
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.json, answers[0].json);
  }
  assert.equal(answers[0].json.message, "If the details match, we've sent a link to your email.");
  assert.equal(sentLinks.length, 1);
  assert.ok(await AuditLog.exists({ action: "my_booking_lookup_failed" }));
  const stored = await BookingAccessLink.findOne({ booking: booking._id }).lean();
  assert.ok(!sentLinks[0].includes(stored.tokenHash));
  assert.equal(stored.tokenHash, core.hashSecret(decodeURIComponent(sentLinks[0].split("#token=")[1])));
});

test("a link works once, sets an httpOnly SameSite cookie and opens only its own booking", { skip }, async () => {
  const booking = await makeBooking();
  const other = await makeBooking({ customer: { ...booking.customer.toObject(), email: "someone@example.test" } });
  sentLinks.length = 0;
  await request("POST", "/api/my-booking/lookup", { body: { reference: booking.bookingReference, email: booking.customer.email }, headers: { "x-forwarded-for": "10.0.1.1" } });
  const token = decodeURIComponent(sentLinks[0].split("#token=")[1]);
  const opened = await request("POST", "/api/my-booking/session", { body: { token } });
  assert.equal(opened.status, 200);
  const setCookie = opened.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Max-Age=2592000/);
  assert.equal((await request("POST", "/api/my-booking/session", { body: { token } })).status, 410);

  const cookie = setCookie.split(";")[0];
  const dashboard = await request("GET", `/api/my-booking/bookings/${booking.bookingReference}`, { cookie });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.headers.get("cache-control"), "no-store, private");
  assert.equal(dashboard.json.data.lead.name, "A•••• B••••");
  assert.ok(!dashboard.text.includes("amani@example.test") && !dashboard.text.includes("778775123"));
  assert.equal((await request("GET", `/api/my-booking/bookings/${other.bookingReference}`, { cookie })).status, 404);
  assert.equal((await request("GET", `/api/bookings/${other.bookingReference}`, { cookie })).status, 404);

  const pdf = await request("GET", `/api/my-booking/bookings/${booking.bookingReference}/ticket.pdf`, { cookie });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(pdf.raw.subarray(0, 4).toString(), "%PDF");
  const qr = await request("GET", `/api/my-booking/bookings/${booking.bookingReference}/ticket-qr.svg`, { cookie });
  assert.match(qr.text, /^<svg/);
});

test("an expired link is refused", { skip }, async () => {
  const booking = await makeBooking();
  const token = core.randomSecret();
  await BookingAccessLink.create({ tokenHash: core.hashSecret(token), booking: booking._id, bookingReference: booking.bookingReference, email: booking.customer.email, expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await request("POST", "/api/my-booking/session", { body: { token } })).status, 410);
});

test("changes need the CSRF token, the site origin and an idempotency key", { skip }, async () => {
  const booking = await makeBooking();
  const { cookie, csrf } = await signIn(booking);
  const path = `/api/my-booking/bookings/${booking.bookingReference}/requests`;
  const body = { type: "reschedule", requestedChanges: { date: "2026-12-01", startTime: "09:00" }, customerReason: "Flight moved" };
  assert.equal((await request("POST", path, { cookie, body })).status, 403);
  assert.equal((await request("POST", path, { cookie, body, headers: { "x-csrf-token": csrf, origin: "https://evil.example" } })).status, 403);
  assert.equal((await request("POST", path, { cookie, body, headers: { "x-csrf-token": csrf } })).status, 400);
  const key = crypto.randomUUID();
  const first = await request("POST", path, { cookie, body, headers: { "x-csrf-token": csrf, "idempotency-key": key } });
  assert.equal(first.status, 201, first.text);
  const again = await request("POST", path, { cookie, body, headers: { "x-csrf-token": csrf, "idempotency-key": key } });
  assert.equal(again.status, 201);
  assert.equal(again.json.data.reference, first.json.data.reference);
  assert.ok(await AuditLog.exists({ action: "my_booking_change_requested", reference: booking.bookingReference }));
});

test("sign out ends the session on the server", { skip }, async () => {
  const booking = await makeBooking();
  const { cookie, csrf } = await signIn(booking);
  const out = await request("POST", "/api/my-booking/session/sign-out", { cookie, headers: { "x-csrf-token": csrf } });
  assert.equal(out.status, 200);
  assert.equal((await request("GET", `/api/my-booking/bookings/${booking.bookingReference}`, { cookie })).status, 404);
});

test("lookup is rate limited per address", { skip }, async () => {
  let last;
  for (let index = 0; index < 11; index += 1) {
    last = await request("POST", "/api/my-booking/lookup", { body: { reference: `ZNZ-RATE${index}AB`, email: "x@example.test" }, headers: { "x-forwarded-for": "10.9.9.9" } });
  }
  assert.equal(last.status, 429);
});

test("lookup is rate limited per reference across addresses", { skip }, async () => {
  let last;
  for (let index = 0; index < 9; index += 1) {
    last = await request("POST", "/api/my-booking/lookup", { body: { reference: "ZNZ-SAMEREF1", email: "x@example.test" }, headers: { "x-forwarded-for": `10.8.0.${index}` } });
  }
  assert.equal(last.status, 429);
});
