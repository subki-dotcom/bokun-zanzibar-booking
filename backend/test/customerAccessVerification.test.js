// Phase 2B: single-use emailed verification links, trusted proxy handling and spoofed headers.
// The HTTP tests launch their own throwaway mongod; no real email is ever sent (the sender is
// replaced and any outbound axios.post fails the run).
process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://127.0.0.1:1/unused-access-verification";
process.env.JWT_SECRET = "access-verification-fixture-secret";
process.env.FRONTEND_URL = "https://zanzibartoursandsafaris.co.tz";
process.env.TRUST_PROXY = "1";
process.env.BOKUN_MOCK_MODE = "true";
process.env.EMAIL_ENABLED = "true";
process.env.EMAIL_PROVIDER = "resend";
process.env.RESEND_API_KEY = "test-only-never-sent";
process.env.EMAIL_FROM = "test@example.com";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");

const outbound = [];
axios.post = async (url) => {
  outbound.push(url);
  throw new Error("Outbound HTTP is not allowed in this test");
};

const { parseTrustProxy } = require("../src/config/trustProxy");
const { resolveClientIp } = require("../src/middleware/rateLimiter");
const { createCustomerAccessVerification, REQUEST_MESSAGE } = require("../src/services/bookings/customerAccessVerification");

const listen = async (handler) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
};
const close = (server) => new Promise((resolve) => server.close(resolve));

test("TRUST_PROXY accepts hop counts, no proxy and address lists, and refuses trust-everything", () => {
  assert.equal(parseTrustProxy(undefined), 1);
  assert.equal(parseTrustProxy(""), 1);
  assert.equal(parseTrustProxy("1"), 1);
  assert.equal(parseTrustProxy("2"), 2);
  assert.equal(parseTrustProxy("0"), false);
  assert.equal(parseTrustProxy("false"), false);
  assert.deepEqual(parseTrustProxy("loopback, 10.0.0.0/8"), ["loopback", "10.0.0.0/8"]);
  assert.throws(() => parseTrustProxy("true"), /TRUST_PROXY=true/);
  assert.throws(() => parseTrustProxy("TRUE"), /TRUST_PROXY=true/);
});

test("rate-limit keys come from req.ip, never from the client-controlled X-Forwarded-For entry", () => {
  assert.equal(resolveClientIp({ ip: "203.0.113.9", headers: { "x-forwarded-for": "198.51.100.1" } }), "203.0.113.9");
  assert.equal(resolveClientIp({ headers: { "x-forwarded-for": "198.51.100.1" }, socket: { remoteAddress: "10.0.0.5" } }), "10.0.0.5");
});

test("spoofed forwarded headers: only the address appended by the trusted proxy is used", async () => {
  for (const [setting, spoofedHeader, expected] of [
    // One trusted hop: the proxy appends the real client; anything the client prepended is ignored.
    ["1", "6.6.6.6, 203.0.113.7", "203.0.113.7"],
    ["1", "203.0.113.7", "203.0.113.7"],
    // No proxy configured: forwarded headers are ignored entirely.
    ["false", "6.6.6.6, 203.0.113.7", "127.0.0.1"],
    // Only loopback is a trusted proxy: the first untrusted address from the right is the client.
    ["loopback", "6.6.6.6, 203.0.113.7", "203.0.113.7"]
  ]) {
    const app = express();
    app.set("trust proxy", parseTrustProxy(setting));
    app.get("/ip", (req, res) => res.json({ key: resolveClientIp(req) }));
    const server = await listen(app);
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/ip`, { headers: { "x-forwarded-for": spoofedHeader } });
      const { key } = await response.json();
      assert.equal(key.replace(/^::ffff:/, ""), expected, `${setting} / ${spoofedHeader}`);
    } finally {
      await close(server);
    }
  }
});

test("verification is unavailable, not silently skipped, when email or the site link is not configured", async () => {
  const Booking = { findOne: () => assert.fail("must not query bookings") };
  for (const options of [{ configured: false, siteOrigin: "https://example.test" }, { configured: true, siteOrigin: "" }]) {
    const service = createCustomerAccessVerification({ Booking, sendEmail: async () => {}, ...options });
    await assert.rejects(() => service.requestAccessLink({ bookingReference: "ZNZ-1-1", email: "a@example.test" }), { code: "BOOKING_VERIFICATION_UNAVAILABLE" });
  }
});

const binary = process.env.MONGOD_BINARY || (process.platform === "win32" ? "C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe" : "/usr/bin/mongod");

test("isolated Mongo: single-use emailed verification over HTTP", { skip: !fs.existsSync(binary), timeout: 180000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "access-verification-test-"));
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(binary, ["--bind_ip", "127.0.0.1", "--port", String(port), "--dbpath", directory, "--quiet"], { windowsHide: true, stdio: "ignore" });
  let server;
  try {
    await mongoose.connect(`mongodb://127.0.0.1:${port}/access_verification_test`, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 30000 });
    assert.equal(mongoose.connection.name, "access_verification_test");

    const app = require("../src/app");
    const Booking = require("../src/models/Booking");
    const Invoice = require("../src/models/Invoice");
    const emailService = require("../src/services/email");
    const sent = [];
    let failDelivery = false;
    t.mock.method(emailService, "sendBookingAccessEmail", async (message) => {
      if (failDelivery) throw new Error("provider said: secret body");
      sent.push(message);
    });

    const objectId = () => new mongoose.Types.ObjectId();
    const fixture = (reference, emailAddress) => ({
      _id: objectId(), bookingReference: reference, bokunProductId: "p1", bokunOptionId: "o1", productTitle: "Prison Island",
      optionTitle: "Shared", travelDate: "2026-12-02", paymentStatus: "paid", bookingStatus: "confirmed", amount: 80, currency: "USD",
      pricingSnapshot: { currency: "USD", finalPayable: 80, lineItems: [] },
      invoiceSnapshot: { invoiceNumber: "INV-" + reference, total: 80, amountPaid: 80, balanceDue: 0, paymentStatus: "paid" },
      customer: { firstName: "Guest", lastName: "Fixture", email: emailAddress, phone: "+255700000009" },
      createdAt: new Date(), updatedAt: new Date()
    });
    const bookings = {};
    for (const [name, email] of Object.entries({ a: "Guest.A@Example.test", b: "guest.b@example.test", c: "guest.c@example.test", d: "guest.d@example.test", e: "guest.e@example.test", f: "guest.f@example.test" })) {
      bookings[name] = fixture(`ZNZ-17000000000${name.charCodeAt(0)}-2000`, email);
    }
    await Booking.collection.insertMany(Object.values(bookings));
    await Invoice.collection.insertMany(Object.values(bookings).map((booking) => ({
      _id: objectId(), invoiceNumber: booking.invoiceSnapshot.invoiceNumber, bookingReference: booking.bookingReference, total: 80, clientEmail: booking.customer.email
    })));

    server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}/api`;
    let clientNumber = 0;
    // The X-Forwarded-For value stands in for the address the trusted proxy appends.
    const client = (ip = `192.0.2.${(clientNumber += 1)}`) => async (method, route, { body, token, headers = {} } = {}) => {
      const response = await fetch(base + route, {
        method,
        headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(token ? { "X-Booking-Access-Token": token } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: response.status, headers: response.headers, body: await response.json() };
    };
    const settle = async (count) => {
      for (let attempt = 0; attempt < 100 && sent.length < count; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      await new Promise((resolve) => setTimeout(resolve, 50));
    };
    const secretFrom = (message) => new URLSearchParams(new URL(message.verifyUrl).hash.slice(1)).get("verify");
    const rewindCooldown = (booking) =>
      Booking.collection.updateOne({ _id: booking._id }, { $set: { customerAccessChallengeRequestedAt: new Date(Date.now() - 5 * 60000) } });
    const request = (booking, email, ip) => client(ip)("POST", "/bookings/access/request", { body: { bookingReference: booking.bookingReference, email } });
    const redeem = (booking, verification, ip) => client(ip)("POST", "/bookings/access/redeem", { body: { bookingReference: booking.bookingReference, verification } });
    const withoutMeta = ({ meta: _meta, ...body }) => body;

    await t.test("a matching request emails a single-use link to the stored address and reveals nothing", async () => {
      const response = await request(bookings.a, "  guest.a@EXAMPLE.test ");
      assert.equal(response.status, 202);
      assert.equal(response.body.message, REQUEST_MESSAGE);
      assert.deepEqual(response.body.data, {});
      assert.match(response.headers.get("cache-control"), /no-store/);
      await settle(1);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to, "Guest.A@Example.test", "sent to the address on the booking");
      const url = new URL(sent[0].verifyUrl);
      assert.equal(url.origin + url.pathname, `https://zanzibartoursandsafaris.co.tz/my-booking/${bookings.a.bookingReference}`);
      assert.equal(url.search, "", "the secret is never in a query string");
      const secret = secretFrom(sent[0]);
      assert.match(secret, /^[a-f0-9]{64}$/);
      const stored = await Booking.collection.findOne({ _id: bookings.a._id });
      assert.notEqual(stored.customerAccessChallengeHash, secret);
      assert.ok(!JSON.stringify(stored).includes(secret), "only a hash is stored");
      // Challenge fields never leak through ordinary booking reads.
      const normal = await Booking.findById(bookings.a._id).lean();
      assert.equal(normal.customerAccessChallengeHash, undefined);
    });

    await t.test("redeeming once yields a working token with no PII; a replay fails", async () => {
      const secret = secretFrom(sent[0]);
      const first = await redeem(bookings.a, secret);
      assert.equal(first.status, 200);
      assert.deepEqual(Object.keys(first.body.data).sort(), ["accessToken", "bookingReference", "expiresAt"]);
      assert.match(first.headers.get("cache-control"), /no-store/);
      const token = first.body.data.accessToken;
      const lookup = client();
      assert.equal((await lookup("GET", `/bookings/${bookings.a.bookingReference}`, { token })).status, 200);
      assert.equal((await lookup("GET", `/invoices/booking/${bookings.a.bookingReference}`, { token })).status, 200);
      // Cross-customer: the token opens nothing else.
      assert.equal((await lookup("GET", `/bookings/${bookings.b.bookingReference}`, { token })).status, 404);
      const replay = await redeem(bookings.a, secret);
      assert.equal(replay.status, 400);
      assert.equal(replay.body.error.code, "BOOKING_VERIFICATION_INVALID");
      // A link only works for the booking it was issued for.
      await rewindCooldown(bookings.a);
      await request(bookings.a, "guest.a@example.test");
      await settle(2);
      assert.equal((await redeem(bookings.b, secretFrom(sent[1]))).status, 400);
    });

    await t.test("concurrent redemption of one link succeeds exactly once", async () => {
      const secret = secretFrom(sent[1]);
      const results = await Promise.all(Array.from({ length: 12 }, (_, index) => redeem(bookings.a, secret, `198.18.0.${index + 1}`)));
      assert.equal(results.filter((result) => result.status === 200).length, 1);
      assert.ok(results.filter((result) => result.status !== 200).every((result) => result.body.error.code === "BOOKING_VERIFICATION_INVALID"));
    });

    await t.test("expired links fail; a newer link replaces an older one", async () => {
      const before = sent.length;
      await request(bookings.c, "guest.c@example.test");
      await settle(before + 1);
      const older = secretFrom(sent[sent.length - 1]);
      await Booking.collection.updateOne({ _id: bookings.c._id }, { $set: { customerAccessChallengeExpiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await redeem(bookings.c, older)).status, 400, "expired");
      await rewindCooldown(bookings.c);
      await request(bookings.c, "guest.c@example.test");
      await settle(before + 2);
      const newer = secretFrom(sent[sent.length - 1]);
      await rewindCooldown(bookings.c);
      await request(bookings.c, "guest.c@example.test");
      await settle(before + 3);
      const newest = secretFrom(sent[sent.length - 1]);
      assert.equal((await redeem(bookings.c, newer)).status, 400, "replaced");
      assert.equal((await redeem(bookings.c, newest)).status, 200);
    });

    await t.test("wrong email, unknown reference and cooldown answer identically and send nothing", async () => {
      const before = sent.length;
      const wrongEmail = await request(bookings.d, "attacker@example.org");
      const unknown = await client()("POST", "/bookings/access/request", { body: { bookingReference: "ZNZ-1700000000999-9997", email: "attacker@example.org" } });
      const malformedReference = await client()("POST", "/bookings/access/request", { body: { bookingReference: "<script>", email: "attacker@example.org" } });
      const matched = await request(bookings.d, "guest.d@example.test");
      const cooldown = await request(bookings.d, "guest.d@example.test");
      for (const response of [wrongEmail, unknown, malformedReference, matched, cooldown]) {
        assert.equal(response.status, 202);
        assert.deepEqual(withoutMeta(response.body), withoutMeta(wrongEmail.body));
        assert.ok(!JSON.stringify(response.body).includes("@example.test"));
      }
      await settle(before + 1);
      assert.equal(sent.length, before + 1, "only the matching request sent mail, once despite the repeat");
      // Bad or guessed verifications all look the same.
      for (const verification of ["", "x", "f".repeat(64), "F".repeat(64)]) {
        const bad = await redeem(bookings.d, verification);
        // Empty input fails request validation; everything else gets the single "invalid link" answer.
        assert.ok(verification ? bad.status === 400 && bad.body.error.code === "BOOKING_VERIFICATION_INVALID" : [400, 422].includes(bad.status));
        assert.ok(!JSON.stringify(bad.body).includes("accessToken"));
      }
    });

    await t.test("a failed delivery withdraws the link and logs nothing from the provider", async (st) => {
      const logged = [];
      st.mock.method(require("../src/config/logger"), "error", (...args) => { logged.push(JSON.stringify(args)); });
      failDelivery = true;
      await request(bookings.e, "guest.e@example.test");
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const stored = await Booking.collection.findOne({ _id: bookings.e._id });
        if (!stored.customerAccessChallengeHash) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      failDelivery = false;
      const stored = await Booking.collection.findOne({ _id: bookings.e._id });
      assert.equal(stored.customerAccessChallengeHash, undefined);
      assert.equal(stored.customerAccessChallengeExpiresAt, undefined);
      assert.ok(logged.some((entry) => entry.includes("BOOKING_ACCESS_EMAIL_FAILED")));
      assert.ok(logged.every((entry) => !entry.includes("secret body") && !entry.includes("guest.e@") && !entry.includes("#verify")));
    });

    await t.test("issuance is limited per booking across addresses and per address across bookings", async () => {
      const responses = [];
      for (let attempt = 0; attempt < 4; attempt += 1) responses.push(await request(bookings.f, `guess${attempt}@example.org`, `203.0.113.${attempt + 10}`));
      assert.deepEqual(responses.map((response) => response.status), [202, 202, 202, 429]);
      assert.equal(responses[3].body.error.code, "BOOKING_ACCESS_RATE_LIMITED");
      const sameAddress = "203.0.113.200";
      const statuses = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        statuses.push((await client(sameAddress)("POST", "/bookings/access/request", { body: { bookingReference: `ZNZ-1700000000${attempt}00-3000`, email: "x@example.org" } })).status);
      }
      assert.deepEqual(statuses, [202, 202, 202, 202, 202, 429]);
    });

    await t.test("spoofed X-Forwarded-For entries cannot escape redeem or lookup limits", async () => {
      // The trusted proxy appends the real client (203.0.113.250); the attacker varies what it prepends.
      const real = "203.0.113.250";
      let last;
      for (let attempt = 0; attempt < 11; attempt += 1) {
        last = await client(`10.${attempt}.0.1, ${real}`)("POST", "/bookings/access/redeem", { body: { bookingReference: bookings.b.bookingReference, verification: "0".repeat(64) } });
      }
      assert.equal(last.status, 429);
      const scannerAddress = "203.0.113.251";
      for (let attempt = 0; attempt < 31; attempt += 1) {
        last = await client(`172.16.${attempt}.1, ${scannerAddress}`)("GET", `/bookings/ZNZ-17000000${String(attempt).padStart(5, "0")}-4444`);
      }
      assert.equal(last.status, 429);
      assert.equal(last.body.error.code, "BOOKING_LOOKUP_RATE_LIMITED");
    });

    await t.test("the Phase 2 direct email exchange no longer exists", async () => {
      const response = await client()("POST", "/bookings/access", { body: { bookingReference: bookings.b.bookingReference, email: "guest.b@example.test" } });
      assert.equal(response.status, 404);
      assert.ok(!JSON.stringify(response.body).includes("accessToken"));
    });

    assert.deepEqual(outbound, [], "no email or other outbound HTTP was attempted");
  } finally {
    if (server) await close(server);
    await mongoose.disconnect();
    if (child.exitCode === null) { child.kill(); await once(child, "exit"); }
    // Delete only the unique temporary directory created by this test.
    const resolved = fs.realpathSync(directory);
    const tempRoot = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved), tempRoot);
    assert.ok(path.basename(resolved).startsWith("access-verification-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
