// Phase 2: customer booking lookup, invoice access and Agent ownership.
// Unit tests run everywhere; the HTTP tests launch their own throwaway mongod and never read
// application .env or MONGO_URI.
process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://127.0.0.1:1/unused-booking-access";
process.env.JWT_SECRET = "booking-access-fixture-secret";
process.env.BOOKING_ACCESS_TOKEN_SECRET = "";
process.env.BOKUN_MOCK_MODE = "true";
process.env.EMAIL_ENABLED = "false";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const access = require("../src/security/bookingAccess");
const noStore = require("../src/middleware/noStore");

const DAY = 24 * 60 * 60 * 1000;
const objectId = () => new mongoose.Types.ObjectId();

test("access tokens open only their booking, expire, and are revoked by the access version", () => {
  const booking = { _id: objectId() };
  const other = { _id: objectId() };
  const { token, expiresAt } = access.issueBookingAccessToken(booking);
  assert.ok(new Date(expiresAt).getTime() > Date.now() + 170 * DAY);
  assert.equal(access.verifyBookingAccessToken(booking, token), true);
  assert.equal(access.verifyBookingAccessToken(other, token), false, "cross-booking token");
  assert.equal(access.verifyBookingAccessToken({ ...booking, customerAccessVersion: 1 }, token), false, "revoked");

  const expired = access.issueBookingAccessToken(booking, { now: Date.now() - 10 * DAY, ttlDays: 1 }).token;
  assert.equal(access.verifyBookingAccessToken(booking, expired), false, "expired");

  const [expiry, signature] = token.split(".");
  const flipped = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
  const extended = `${(Number.parseInt(expiry, 36) + 1000).toString(36)}.${signature}`;
  for (const bad of ["", "x", `${expiry}.${flipped}`, extended, `${token}x`, token.toUpperCase(), null, 42]) {
    assert.equal(access.verifyBookingAccessToken(booking, bad), false, `rejects ${String(bad)}`);
  }
});

test("the reference or invoice number alone never resolves access", () => {
  const booking = { _id: objectId(), bookingReference: "ZNZ-1700000000000-1234", agentId: objectId() };
  assert.equal(access.resolveBookingAccess({ booking }), null);
  assert.equal(access.resolveBookingAccess({ booking, accessToken: booking.bookingReference }), null);
  assert.equal(access.resolveBookingAccess({ booking, auth: { role: "agent", id: String(objectId()), userType: "agent" } }), null);
  assert.equal(access.resolveBookingAccess({ booking, auth: { role: "agent", id: String(booking.agentId), userType: "agent" } }), "agent");
  // An Agent account can never present itself as back office, whatever role claim it carries.
  assert.equal(access.resolveBookingAccess({ booking, auth: { role: "admin", id: "x", userType: "agent" } }), null);
  for (const role of ["super_admin", "admin", "staff"]) {
    assert.equal(access.resolveBookingAccess({ booking, auth: { role, id: "x", userType: "user" } }), "back_office");
  }
});

test("email verification ignores case and spacing but nothing else", () => {
  assert.equal(access.emailMatches("  Guest@Example.COM ", "guest@example.com"), true);
  assert.equal(access.emailMatches("guest@example.co", "guest@example.com"), false);
  assert.equal(access.emailMatches("", ""), false);
  assert.equal(access.emailMatches("guest@example.com", undefined), false);
});

test("only a request that created the booking receives its token", () => {
  const data = { bookingId: String(objectId()), bookingReference: "ZNZ-1-1", redirectUrl: "https://pay.invalid" };
  const created = access.withNewBookingAccess(data, { quoteToken: "q".repeat(12) });
  assert.equal(access.verifyBookingAccessToken({ _id: data.bookingId }, created.bookingAccessToken), true);
  assert.equal(access.withNewBookingAccess(data, { bookingId: data.bookingId }).bookingAccessToken, undefined);
  assert.equal(access.withNewBookingAccess({ redirectUrl: "" }, {}).bookingAccessToken, undefined);
});

test("payment return projection drops customer, supplier, cost and commission internals", () => {
  const full = {
    _id: objectId(), bookingReference: "ZNZ-1-2", paymentStatus: "paid", bookingStatus: "pending",
    supplierStatus: "supplier_pending", productTitle: "Stone Town", travelDate: "2026-12-01", agentId: objectId(),
    customer: { email: "guest@example.com", phone: "+255700000000" },
    rawBokunResponse: { secret: true }, estimatedCostSnapshot: { supplierNet: 40 },
    commission: { commissionAmount: 9 }, paymentInitiation: { token: "t" },
    pendingCheckout: { finalizationPending: true, checkoutPayload: { customer: {} }, pesapalTrackingId: "x" },
    pricingSnapshot: { currency: "USD", finalPayable: 100 }, invoiceSnapshot: { amountPaid: 100, clientEmail: "guest@example.com" }
  };
  const view = access.toCustomerPaymentBooking(full);
  for (const field of ["customer", "rawBokunResponse", "estimatedCostSnapshot", "commission", "paymentInitiation", "agentId"]) {
    assert.equal(field in view, false, field);
  }
  assert.deepEqual(view.pendingCheckout, { finalizationPending: true });
  assert.equal(view.invoiceSnapshot.clientEmail, undefined);
  assert.equal(view.isAgentBooking, true);
  assert.equal(view.bookingReference, "ZNZ-1-2");
  assert.equal(view.pricingSnapshot.finalPayable, 100);
  assert.equal(String(view.bookingId), String(full._id));
  assert.equal(access.withCustomerPaymentBooking({ status: "failed" }).booking, undefined);
});

test("customer invoice projection keeps printable fields and drops ledger internals", () => {
  const view = access.toCustomerInvoice({
    invoiceNumber: "INV-1", bookingReference: "ZNZ-1-3", clientName: "Guest", total: 100,
    accountingJournalEntryId: objectId(), accountingPostingKey: "k", accountingBlockers: ["x"], accountingStatus: "POSTED",
    deliveryEvidence: { note: "internal" }, totalAmount: "100.00", items: [{ label: "Adult", quantity: 1, unitPrice: 100, total: 100, _id: objectId() }]
  });
  assert.equal(view.invoiceNumber, "INV-1");
  assert.equal(view.total, 100);
  assert.deepEqual(view.items, [{ label: "Adult", quantity: 1, unitPrice: 100, total: 100 }]);
  for (const field of ["accountingJournalEntryId", "accountingPostingKey", "accountingBlockers", "accountingStatus", "deliveryEvidence", "totalAmount", "_id"]) {
    assert.equal(field in view, false, field);
  }
});

test("sensitive responses are marked no-store", () => {
  const headers = {};
  const res = { set: (key, value) => { headers[key] = value; }, vary: (value) => { headers.Vary = [...(headers.Vary || []), value]; } };
  let called = false;
  noStore({}, res, () => { called = true; });
  assert.equal(called, true);
  assert.match(headers["Cache-Control"], /no-store/);
  assert.deepEqual(headers.Vary, ["Authorization", "X-Booking-Access-Token"]);
});

const binary = process.env.MONGOD_BINARY || (process.platform === "win32" ? "C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe" : "/usr/bin/mongod");

test("isolated Mongo: booking, invoice and Agent ownership over HTTP", { skip: !fs.existsSync(binary), timeout: 180000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "booking-access-test-"));
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(binary, ["--bind_ip", "127.0.0.1", "--port", String(port), "--dbpath", directory, "--quiet"], { windowsHide: true, stdio: "ignore" });
  let server;
  try {
    await mongoose.connect(`mongodb://127.0.0.1:${port}/booking_access_test`, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 30000 });
    assert.equal(mongoose.connection.name, "booking_access_test");

    const app = require("../src/app");
    const Booking = require("../src/models/Booking");
    const Invoice = require("../src/models/Invoice");
    const User = require("../src/models/User");
    const Agent = require("../src/models/Agent");
    const email = require("../src/services/email");
    const dpoService = require("../src/services/payments/dpo");
    const paypalService = require("../src/services/payments/paypal");
    const pesapalService = require("../src/services/payments/pesapal");

    // Fixtures are inserted directly so model hooks cannot reach any external service.
    const ids = { agentA: objectId(), agentB: objectId(), superAdmin: objectId(), admin: objectId(), staff: objectId() };
    await User.collection.insertMany([
      { _id: ids.superAdmin, firstName: "Super", lastName: "Admin", fullName: "Super Admin", email: "owner@example.test", password: "x".repeat(60), role: "super_admin", isActive: true, tokenVersion: 0 },
      { _id: ids.admin, firstName: "Admin", lastName: "User", fullName: "Admin User", email: "admin@example.test", password: "x".repeat(60), role: "admin", isActive: true, tokenVersion: 0 },
      { _id: ids.staff, firstName: "Finance", lastName: "Staff", fullName: "Finance Staff", email: "finance@example.test", password: "x".repeat(60), role: "staff", isActive: true, tokenVersion: 0 }
    ]);
    await Agent.collection.insertMany([
      { _id: ids.agentA, companyName: "Agent A", contactFirstName: "A", contactLastName: "A", fullName: "Agent A", email: "a@agents.test", password: "x".repeat(60), role: "agent", isActive: true },
      { _id: ids.agentB, companyName: "Agent B", contactFirstName: "B", contactLastName: "B", fullName: "Agent B", email: "b@agents.test", password: "x".repeat(60), role: "agent", isActive: true }
    ]);
    const bookingFixture = (reference, overrides = {}) => ({
      _id: objectId(), bookingReference: reference, bokunProductId: "p1", bokunOptionId: "o1", productTitle: "Stone Town Walk",
      optionTitle: "Private", travelDate: "2026-12-01", startTime: "09:00", paymentStatus: "paid", bookingStatus: "confirmed",
      supplierStatus: "confirmed", bokunBookingId: "b-" + reference, bokunConfirmationCode: "RTS-" + reference, amount: 120, currency: "USD",
      pricingSnapshot: { currency: "USD", grossAmount: 120, finalPayable: 120, lineItems: [] },
      invoiceSnapshot: { invoiceNumber: "INV-" + reference, total: 120, amountPaid: 120, balanceDue: 0, paymentStatus: "paid" },
      customer: { firstName: "Guest", lastName: reference, email: `guest.${reference.toLowerCase()}@example.test`, phone: "+255700000001" },
      rawBokunResponse: { internal: true }, estimatedCostSnapshot: { supplierNet: 70 }, agentId: null,
      pendingCheckout: { checkoutPayload: { quoteToken: "secret-quote" } }, createdAt: new Date(), updatedAt: new Date(),
      ...overrides
    });
    const bookings = {
      customerA: bookingFixture("ZNZ-1700000000001-1001"),
      customerB: bookingFixture("ZNZ-1700000000002-1002"),
      agentA: bookingFixture("ZNZ-1700000000003-1003", { agentId: ids.agentA, sourceChannel: "agent_portal" }),
      agentB: bookingFixture("ZNZ-1700000000004-1004", { agentId: ids.agentB, sourceChannel: "agent_portal" })
    };
    await Booking.collection.insertMany(Object.values(bookings));
    const invoiceFixture = (booking) => ({
      _id: objectId(), invoiceNumber: booking.invoiceSnapshot.invoiceNumber, bookingReference: booking.bookingReference,
      clientName: "Guest", clientEmail: booking.customer.email, tourName: booking.productTitle, total: 120, amountPaid: 120,
      balanceDue: 0, paymentStatus: "paid", accountingStatus: "POSTED", accountingPostingKey: "posting-" + booking.bookingReference,
      accountingJournalEntryId: objectId(), items: [{ label: "Adult", quantity: 1, unitPrice: 120, total: 120 }], createdAt: new Date()
    });
    await Invoice.collection.insertMany([
      ...Object.values(bookings).map(invoiceFixture),
      { _id: objectId(), invoiceNumber: "INV-STANDALONE-0001", bookingReference: "STANDALONE-0001", invoiceType: "STANDALONE", clientName: "Walk-in", total: 50, accountingPostingKey: "standalone" }
    ]);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    let clientNumber = 0;
    // Each scenario uses its own client address so failure-counting limits stay independent.
    const client = () => {
      clientNumber += 1;
      const ip = `198.51.100.${clientNumber}`;
      return async (method, route, { token, bearer, body, headers = {} } = {}) => {
        const response = await fetch(base + route, {
          method,
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": ip,
            ...(token ? { "X-Booking-Access-Token": token } : {}),
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
            ...headers
          },
          body: body ? JSON.stringify(body) : undefined
        });
        return { status: response.status, headers: response.headers, body: await response.json() };
      };
    };
    const userJwt = (id) => jwt.sign({ sub: String(id), userType: "user", tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "5m" });
    const agentJwt = (id) => jwt.sign({ sub: String(id), userType: "agent", tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "5m" });
    const tokenFor = (booking, options) => access.issueBookingAccessToken(booking, options).token;
    const assertNoStore = (response) => assert.match(response.headers.get("cache-control") || "", /no-store/);
    const assertDenied = (response) => {
      assert.equal(response.status, 404);
      assert.equal(response.body.error.code, "BOOKING_NOT_FOUND");
      assert.deepEqual(response.body.data, {});
      assert.ok(!JSON.stringify(response.body).includes("@example.test"));
    };

    await t.test("1. authorized customer booking lookup returns least-privilege fields, never cached", async () => {
      const call = client();
      const response = await call("GET", `/bookings/${bookings.customerA.bookingReference}`, { token: tokenFor(bookings.customerA) });
      assert.equal(response.status, 200);
      assertNoStore(response);
      const data = response.body.data;
      assert.equal(data.bookingReference, bookings.customerA.bookingReference);
      assert.equal(data.customer.email, bookings.customerA.customer.email);
      for (const field of ["rawBokunResponse", "estimatedCostSnapshot", "agentId", "customerAccessVersion"]) assert.equal(field in data, false, field);
      assert.equal(data.pendingCheckout.checkoutPayload, undefined);
    });

    await t.test("2-3. unauthorized lookup and a reference without a token look exactly like a missing booking", async () => {
      const call = client();
      const withoutToken = await call("GET", `/bookings/${bookings.customerA.bookingReference}`);
      const missing = await call("GET", "/bookings/ZNZ-1700000000999-9999");
      assertDenied(withoutToken);
      assertDenied(missing);
      assertNoStore(withoutToken);
      assert.equal(withoutToken.body.message, missing.body.message);
      assertDenied(await call("GET", `/bookings/${bookings.customerA.bookingReference}`, { token: bookings.customerA.bookingReference }));
    });

    await t.test("4. invalid, tampered, expired and revoked tokens are refused", async () => {
      const call = client();
      const reference = `/bookings/${bookings.customerA.bookingReference}`;
      assertDenied(await call("GET", reference, { token: "not-a-token" }));
      assertDenied(await call("GET", reference, { token: tokenFor(bookings.customerA).slice(0, -2) + "zz" }));
      assertDenied(await call("GET", reference, { token: tokenFor(bookings.customerA, { now: Date.now() - 30 * DAY, ttlDays: 1 }) }));
      const issued = tokenFor(bookings.customerA);
      await Booking.collection.updateOne({ _id: bookings.customerA._id }, { $set: { customerAccessVersion: 1 } });
      assertDenied(await call("GET", reference, { token: issued }));
      await Booking.collection.updateOne({ _id: bookings.customerA._id }, { $unset: { customerAccessVersion: "" } });
      assert.equal((await call("GET", reference, { token: issued })).status, 200);
    });

    await t.test("5. one customer's token never opens another customer's booking or invoice", async () => {
      const call = client();
      const tokenA = tokenFor(bookings.customerA);
      assertDenied(await call("GET", `/bookings/${bookings.customerB.bookingReference}`, { token: tokenA }));
      assert.equal((await call("GET", `/invoices/booking/${bookings.customerB.bookingReference}`, { token: tokenA })).status, 404);
    });

    await t.test("6. invoice number or booking reference alone does not return an invoice", async () => {
      const call = client();
      const byReference = await call("GET", `/invoices/booking/${bookings.customerA.bookingReference}`);
      assert.equal(byReference.status, 404);
      assert.equal(byReference.body.error.code, "INVOICE_NOT_FOUND");
      assertNoStore(byReference);
      assert.equal((await call("GET", `/invoices/${bookings.customerA.invoiceSnapshot.invoiceNumber}`)).status, 401);
      // A customer access token is not a session for the back office invoice endpoint.
      assert.equal((await call("GET", `/invoices/${bookings.customerA.invoiceSnapshot.invoiceNumber}`, { token: tokenFor(bookings.customerA) })).status, 401);
      assert.equal((await call("GET", "/invoices/booking/STANDALONE-0001")).status, 404);
    });

    await t.test("7-8. authorized invoice download is the customer view; unauthorized download is refused", async () => {
      const call = client();
      const allowed = await call("GET", `/invoices/booking/${bookings.customerA.bookingReference}`, { token: tokenFor(bookings.customerA) });
      assert.equal(allowed.status, 200);
      assertNoStore(allowed);
      assert.equal(allowed.body.data.invoiceNumber, bookings.customerA.invoiceSnapshot.invoiceNumber);
      assert.equal(allowed.body.data.clientEmail, bookings.customerA.customer.email);
      for (const field of ["accountingPostingKey", "accountingJournalEntryId", "accountingStatus", "_id"]) assert.equal(field in allowed.body.data, false, field);
      const refused = await call("GET", `/invoices/booking/${bookings.customerA.bookingReference}`, { token: tokenFor(bookings.customerB) });
      assert.equal(refused.status, 404);
      assert.deepEqual(refused.body.data, {});
    });

    await t.test("9. an Agent reaches its own booking and invoice", async () => {
      const call = client();
      const bearer = agentJwt(ids.agentA);
      assert.equal((await call("GET", `/bookings/${bookings.agentA.bookingReference}`, { bearer })).status, 200);
      const byNumber = await call("GET", `/invoices/${bookings.agentA.invoiceSnapshot.invoiceNumber}`, { bearer });
      assert.equal(byNumber.status, 200);
      assert.equal(byNumber.body.data.bookingReference, bookings.agentA.bookingReference);
      assert.equal(byNumber.body.data.accountingPostingKey, undefined);
      assert.equal((await call("GET", `/invoices/booking/${bookings.agentA.bookingReference}`, { bearer })).status, 200);
      assert.equal((await call("GET", `/agent/bookings/${bookings.agentA.bookingReference}`, { bearer })).status, 200);
    });

    await t.test("10. an Agent cannot reach another Agent's or a direct customer's records", async () => {
      const call = client();
      const bearer = agentJwt(ids.agentA);
      for (const other of [bookings.agentB, bookings.customerA]) {
        assertDenied(await call("GET", `/bookings/${other.bookingReference}`, { bearer }));
        const byNumber = await call("GET", `/invoices/${other.invoiceSnapshot.invoiceNumber}`, { bearer });
        assert.equal(byNumber.status, 404);
        assert.ok(!JSON.stringify(byNumber.body).includes(other.customer.email));
        assert.equal((await call("GET", `/invoices/booking/${other.bookingReference}`, { bearer })).status, 404);
        assert.equal((await call("GET", `/agent/bookings/${other.bookingReference}`, { bearer })).status, 404);
      }
      assert.equal((await call("GET", "/invoices/INV-STANDALONE-0001", { bearer })).status, 404);
      // The Agent's own list never includes other Agents' bookings.
      const list = await call("GET", "/agent/bookings", { bearer });
      assert.equal(list.status, 200);
      const listed = JSON.stringify(list.body.data);
      assert.ok(listed.includes(bookings.agentA.bookingReference));
      assert.ok(!listed.includes(bookings.agentB.bookingReference));
      assert.ok(!listed.includes(bookings.customerA.bookingReference));
    });

    await t.test("11-12. Finance staff, admin and Super Admin keep full invoice access", async () => {
      const call = client();
      for (const id of [ids.staff, ids.admin, ids.superAdmin]) {
        const bearer = userJwt(id);
        for (const booking of [bookings.customerA, bookings.agentB]) {
          const byNumber = await call("GET", `/invoices/${booking.invoiceSnapshot.invoiceNumber}`, { bearer });
          assert.equal(byNumber.status, 200);
          assert.equal(byNumber.body.data.accountingPostingKey, "posting-" + booking.bookingReference);
          assertNoStore(byNumber);
          assert.equal((await call("GET", `/invoices/booking/${booking.bookingReference}`, { bearer })).status, 200);
          assert.equal((await call("GET", `/bookings/${booking.bookingReference}`, { bearer })).status, 200);
        }
        assert.equal((await call("GET", "/invoices/INV-STANDALONE-0001", { bearer })).status, 200);
      }
    });

    // Emailed verification-link enumeration and limits: test/customerAccessVerification.test.js.
    await t.test("13. enumeration: lookup failures are rate limited per client, successes are not", async () => {
      // Per-address lookup limit counts only failures.
      const scanner = client();
      let last;
      for (let attempt = 0; attempt < 31; attempt += 1) {
        last = await scanner("GET", `/bookings/ZNZ-17000000${String(attempt).padStart(5, "0")}-1111`);
      }
      assert.equal(last.status, 429);
      assert.equal(last.body.error.code, "BOOKING_LOOKUP_RATE_LIMITED");
      const owner = client();
      for (let attempt = 0; attempt < 35; attempt += 1) {
        assert.equal((await owner("GET", `/bookings/${bookings.customerA.bookingReference}`, { token: tokenFor(bookings.customerA) })).status, 200);
      }
    });

    await t.test("15. existing customer links: emailed booking links open only their booking; reference + email is not access", async () => {
      const call = client();
      // The Phase 2 direct exchange of reference + email for a token no longer exists.
      const direct = await call("POST", "/bookings/access", {
        body: { bookingReference: bookings.customerA.bookingReference, email: bookings.customerA.customer.email }
      });
      assert.equal(direct.status, 404);
      assert.ok(!JSON.stringify(direct.body).includes("accessToken"));
      const token = tokenFor(bookings.customerA);
      assert.equal((await call("GET", `/bookings/${bookings.customerA.bookingReference}`, { token })).status, 200);
      assert.equal((await call("GET", `/invoices/booking/${bookings.customerA.bookingReference}`, { token })).status, 200);
      assertDenied(await call("GET", `/bookings/${bookings.customerB.bookingReference}`, { token }));
      // A stale or foreign session in the browser does not block the customer's token.
      const withStaleSession = await call("GET", `/bookings/${bookings.customerA.bookingReference}`, { token, bearer: "expired.jwt.value" });
      assert.equal(withStaleSession.status, 200);
      // Links in booking emails carry a token for that booking only.
      const { html } = email.__testables.buildBookingEmail(bookings.customerB, "booking_confirmed");
      const link = html.match(/href="([^"]+)"/)[1].replace(/&amp;/g, "&");
      // The token is in the fragment, which browsers never send to servers or in Referer headers.
      const emailUrl = new URL(link);
      assert.equal(emailUrl.search, "");
      const emailToken = decodeURIComponent(new URLSearchParams(emailUrl.hash.slice(1)).get("access"));
      assert.ok(link.includes(`/my-booking/${bookings.customerB.bookingReference}#access=`));
      assert.equal((await call("GET", `/bookings/${bookings.customerB.bookingReference}`, { token: emailToken })).status, 200);
      assertDenied(await call("GET", `/bookings/${bookings.customerA.bookingReference}`, { token: emailToken }));
    });

    await t.test("16. payment provider responses: tokens only for new bookings, no internals echoed", async (st) => {
      const call = client();
      const created = { bookingId: String(bookings.customerB._id), bookingReference: bookings.customerB.bookingReference, redirectUrl: "https://pay.invalid/1", paymentStatus: "pending" };
      st.mock.method(pesapalService, "createPayment", async () => created);
      const newCheckout = await call("POST", "/payments/pesapal/create", {
        body: {
          quoteToken: "q".repeat(20), productId: "p1", optionId: "o1", travelDate: "2026-12-01", pax: { adults: 1 },
          customer: { firstName: "Guest", lastName: "Two", email: "guest.two@example.test", phone: "+255700000002" }
        }
      });
      assert.equal(newCheckout.status, 201);
      assert.equal((await call("GET", `/bookings/${created.bookingReference}`, { token: newCheckout.body.data.bookingAccessToken })).status, 200);
      const retry = await call("POST", "/payments/pesapal/create", { body: { bookingId: created.bookingId } });
      assert.equal(retry.status, 201);
      assert.equal(retry.body.data.bookingAccessToken, undefined, "a bookingId alone must not mint a token");

      const fullDocument = await Booking.findById(bookings.customerB._id);
      st.mock.method(dpoService, "handlePaymentSuccess", async () => ({ status: "paid", booking: fullDocument }));
      st.mock.method(paypalService, "handlePaymentSuccess", async () => ({ status: "paid", booking: fullDocument.toObject() }));
      for (const route of ["/payments/dpo/success?TransactionToken=fixture-token", "/payments/paypal/success?token=fixture-order"]) {
        const response = await call("GET", route);
        assert.equal(response.status, 200, route);
        const booking = response.body.data.booking;
        assert.equal(booking.bookingReference, bookings.customerB.bookingReference);
        assert.equal(booking.paymentStatus, "paid");
        const serialized = JSON.stringify(response.body);
        for (const leak of ["guest.zn", "@example.test", "supplierNet", "secret-quote", "rawBokunResponse"]) {
          assert.ok(!serialized.includes(leak), `${route} leaked ${leak}`);
        }
      }
    });

    const collections = (await mongoose.connection.db.listCollections().toArray()).map((item) => item.name).sort();
    assert.ok(collections.every((name) => ["agents", "auditlogs", "bookingrequests", "bookings", "invoices", "productsnapshots", "users"].includes(name)), collections.join(","));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (child.exitCode === null) { child.kill(); await once(child, "exit"); }
    // Delete only the unique temporary directory created by this test.
    const resolved = fs.realpathSync(directory);
    const tempRoot = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved), tempRoot);
    assert.ok(path.basename(resolved).startsWith("booking-access-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
