// Invoice page and PDF: access, numbering, frozen copy, credit notes, signed links, verification.
// Run with MY_BOOKING_TEST_MONGO_URI=mongodb://127.0.0.1:27018 (a throwaway database, never the real one).
process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "invoice-documents-test-secret";
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
const Invoice = require("../src/models/Invoice");
const Refund = require("../src/models/Refund");
const emailService = require("../src/services/email");
const core = require("../src/services/myBooking/core");
const { nextDocumentNumber } = require("../src/services/invoiceDocuments/numbering");
const documents = require("../src/services/invoiceDocuments");

let server;
let base;
const links = [];

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

const makeBooking = async (overrides = {}) => {
  const booking = await Booking.create({
    bookingReference: core.buildBookingReference(),
    bokunProductId: "p-1",
    bokunOptionId: "o-1",
    productTitle: "Zanzibar Transfers",
    optionTitle: "Nungwi hotel to Nungwi hotels",
    travelDate: "2026-11-30",
    startTime: "09:00",
    amount: 45,
    currency: "USD",
    paymentStatus: "paid",
    bookingStatus: "confirmed",
    paxSummary: { adults: 1 },
    pricingSnapshot: { finalPayable: 45, currency: "USD" },
    customer: { firstName: "Amani", lastName: "Bakari", email: `amani-${crypto.randomUUID()}@example.test`, phone: "+255778775123", country: "Tanzania", hotelName: "Nungwi Beach Resort" },
    ...overrides
  });
  const invoice = await Invoice.create({
    invoiceNumber: await nextDocumentNumber("INV"),
    bookingReference: booking.bookingReference,
    issueDate: new Date("2026-10-27T07:00:00Z"),
    paymentStatus: "paid",
    clientName: "Amani Bakari",
    clientEmail: booking.customer.email,
    clientPhone: "+255778775123",
    clientCountry: "Tanzania",
    hotelName: "Nungwi Beach Resort",
    tourName: "Zanzibar Transfers",
    bookedOption: "Nungwi hotel to Nungwi hotels",
    tourDate: "2026-11-30",
    pickupTime: "09:00",
    items: [{ label: "Adult", quantity: 1, unitPrice: 45, total: 45 }],
    subtotal: 45,
    discount: 0,
    tax: 0,
    total: 45,
    amountPaid: 45,
    balanceDue: 0,
    transactionCurrency: "USD"
  });
  return { booking, invoice };
};

const signIn = async (booking) => {
  links.length = 0;
  await request("POST", "/api/my-booking/lookup", { body: { reference: booking.bookingReference, email: booking.customer.email }, headers: { "x-forwarded-for": `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
  const token = decodeURIComponent(links.at(-1).split("#token=")[1]);
  const opened = await request("POST", "/api/my-booking/session", { body: { token } });
  const cookie = opened.headers.get("set-cookie").split(";")[0];
  const session = await request("GET", "/api/my-booking/session", { cookie });
  return { cookie, csrf: session.json.data.csrfToken };
};

test.before(async () => {
  if (skip) return;
  await mongoose.connect(MONGO, { dbName: `invoice_docs_test_${process.pid}_${crypto.randomBytes(4).toString("hex")}`, serverSelectionTimeoutMS: 5000 });
  emailService.sendMyBookingLinkEmail = async ({ url }) => {
    links.push(url);
    return { sent: true };
  };
  emailService.sendInvoiceCopyEmail = async () => ({ sent: true });
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

test("invoice numbers are sequential and unique under concurrency", { skip }, async () => {
  const numbers = await Promise.all(Array.from({ length: 25 }, () => nextDocumentNumber("INV", new Date("2031-03-01T00:00:00Z"))));
  assert.equal(new Set(numbers).size, 25);
  const seqs = numbers.map((value) => Number(value.split("-")[2])).sort((a, b) => a - b);
  assert.deepEqual(seqs, Array.from({ length: 25 }, (_, index) => index + 1));
  assert.match(numbers[0], /^INV-2031-\d{5}$/);
});

test("an existing invoice is not readable without a session, key or staff login", { skip }, async () => {
  const { booking } = await makeBooking();
  for (const path of [`/api/invoices/booking/${booking.bookingReference}`, `/api/my-booking/bookings/${booking.bookingReference}/invoice`, `/api/my-booking/documents/pdf?token=x.y`]) {
    const response = await request("GET", path);
    assert.equal(response.status, 404, path);
    assert.ok(!response.text.includes("Amani"), path);
  }
  assert.equal((await request("GET", `/api/invoices/INV-2026-00001/pdf`)).status, 401);
  assert.equal((await request("GET", `/api/invoices/INV-2026-00001/document`)).status, 401);
});

test("the guest sees the frozen invoice; the issue date and number do not move", { skip }, async () => {
  const { booking, invoice } = await makeBooking();
  const { cookie } = await signIn(booking);
  const first = await request("GET", `/api/my-booking/bookings/${booking.bookingReference}/invoice`, { cookie });
  assert.equal(first.status, 200, first.text);
  const view = first.json.data.invoice;
  assert.equal(view.number, invoice.invoiceNumber);
  assert.equal(view.status.label, "PAID");
  assert.equal(view.total, 45);
  assert.equal(view.balanceDue, 0);
  assert.equal(view.lineItems[0].subDescription, "Nungwi hotel to Nungwi hotels · Adult");
  assert.equal(view.lineItems.at(-1).included, true);
  assert.match(view.verificationUrl, /\/verify\/[A-Za-z0-9_-]{22}$/);
  assert.equal(first.headers.get("cache-control"), "no-store, private");
  // A later sync changes the accounting fields but not the issued copy.
  await Invoice.updateOne({ _id: invoice._id }, { $set: { clientName: "Someone Else", issueDate: new Date() } });
  const second = await request("GET", `/api/my-booking/bookings/${booking.bookingReference}/invoice`, { cookie });
  assert.equal(second.json.data.invoice.billedTo.name, "Amani Bakari");
  assert.equal(second.json.data.invoice.issueDate, view.issueDate);
});

test("PDF links are signed, short-lived, and only work with the session of that booking", { skip }, async () => {
  const { booking } = await makeBooking();
  const other = await makeBooking();
  const mine = await signIn(booking);
  const theirs = await signIn(other.booking);
  const path = `/api/my-booking/bookings/${booking.bookingReference}/invoice/pdf-link`;
  assert.equal((await request("POST", path, { cookie: mine.cookie, body: {} })).status, 403);
  const link = await request("POST", path, { cookie: mine.cookie, body: {}, headers: { "x-csrf-token": mine.csrf } });
  assert.equal(link.status, 200, link.text);
  assert.match(link.json.data.filename, /^ZanzibarTours-Invoice-INV-\d{4}-\d{5}\.pdf$/);
  assert.ok(Date.parse(link.json.data.expiresAt) - Date.now() <= 10 * 60 * 1000);
  const pdf = await request("GET", link.json.data.url, { cookie: mine.cookie });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(pdf.headers.get("cache-control"), "no-store, private");
  assert.equal(pdf.raw.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.raw.toString("latin1").includes("/Title (Invoice INV-") || pdf.raw.toString("latin1").includes("Invoice INV-"));
  assert.equal((await request("GET", link.json.data.url)).status, 404);
  assert.equal((await request("GET", link.json.data.url, { cookie: theirs.cookie })).status, 404);
  const tampered = link.json.data.url.replace(/\.([A-Za-z0-9_-]+)$/, ".AAAA$1");
  assert.equal((await request("GET", tampered, { cookie: mine.cookie })).status, 410);
  const expired = documents.signDownloadLink({ bookingReference: booking.bookingReference, number: "x", now: Date.now() - 11 * 60 * 1000 });
  assert.equal((await request("GET", `/api/my-booking/documents/pdf?token=${encodeURIComponent(expired.token)}`, { cookie: mine.cookie })).status, 410);
});

test("a confirmed refund issues a credit note and the invoice shows REFUNDED", { skip }, async () => {
  const { booking, invoice } = await makeBooking();
  const { cookie } = await signIn(booking);
  await request("GET", `/api/my-booking/bookings/${booking.bookingReference}/invoice`, { cookie });
  await Refund.create({
    refundReference: `RF-${crypto.randomUUID()}`,
    bookingId: booking._id,
    bookingRequestId: new mongoose.Types.ObjectId(),
    amount: 45,
    confirmedRefundedAmount: 45,
    currency: "USD",
    reason: "Cancelled",
    status: "refunded",
    completedAt: new Date()
  });
  await Invoice.updateOne({ _id: invoice._id }, { $set: { amountRefunded: 45, netAmountPaid: 0 } });
  const response = await request("GET", `/api/my-booking/bookings/${booking.bookingReference}/invoice`, { cookie });
  const { invoice: view, creditNotes } = response.json.data;
  assert.equal(view.status.label, "REFUNDED");
  assert.equal(creditNotes.length, 1);
  assert.match(creditNotes[0].number, /^CN-\d{4}-\d{5}$/);
  assert.equal(creditNotes[0].total, 45);
  assert.equal(creditNotes[0].creditFor, view.number);
  // Viewing again does not make a second one.
  const again = await request("GET", `/api/my-booking/bookings/${booking.bookingReference}/invoice`, { cookie });
  assert.equal(again.json.data.creditNotes.length, 1);
});

test("verification shows the invoice without personal data", { skip }, async () => {
  const { booking } = await makeBooking();
  const { cookie } = await signIn(booking);
  const view = (await request("GET", `/api/my-booking/bookings/${booking.bookingReference}/invoice`, { cookie })).json.data.invoice;
  const token = view.verificationUrl.split("/verify/")[1];
  const verified = await request("GET", `/api/invoices/verify/${token}`);
  assert.equal(verified.status, 200);
  assert.deepEqual(Object.keys(verified.json.data).sort(), ["company", "currency", "issueDate", "kind", "number", "status", "total", "valid"]);
  assert.ok(!verified.text.includes("Amani") && !verified.text.includes(booking.customer.email) && !verified.text.includes(booking.bookingReference));
  assert.equal((await request("GET", "/api/invoices/verify/not-a-real-token-123456")).status, 404);
});

test("email me a copy needs CSRF and is limited to 3 an hour", { skip }, async () => {
  const { booking } = await makeBooking();
  const { cookie, csrf } = await signIn(booking);
  const path = `/api/my-booking/bookings/${booking.bookingReference}/invoice/email`;
  assert.equal((await request("POST", path, { cookie, body: {} })).status, 403);
  const statuses = [];
  for (let index = 0; index < 4; index += 1) statuses.push((await request("POST", path, { cookie, body: {}, headers: { "x-csrf-token": csrf } })).status);
  assert.deepEqual(statuses, [200, 200, 200, 429]);
});
