const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createPasswordRecovery } = require("../src/services/auth/passwordRecovery");
const { forgotPasswordSchema, resetPasswordSchema } = require("../src/validators/auth.validation");
const { sanitizePayload } = require("../src/middleware/sanitize");

test("recovery validation preserves passwords and rejects malformed reset credentials", () => {
  const body = { email: " Admin@Example.com ", password: "  long password  " };
  sanitizePayload({ body }, {}, () => {});
  assert.equal(body.password, "  long password  ");
  assert.equal(forgotPasswordSchema.parse({ body: { email: body.email } }).body.email, "admin@example.com");
  for (const password of ["short", "x".repeat(73), "🔐".repeat(20)]) {
    assert.equal(resetPasswordSchema.safeParse({ body: { token: "a".repeat(64), password } }).success, false);
  }
  assert.equal(resetPasswordSchema.safeParse({ body: { token: "bad", password: "long password here" } }).success, false);
});

const binary = process.env.MONGOD_BINARY || (process.platform === "win32" ? "C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe" : "/usr/bin/mongod");
test("isolated Mongo recovery: email delivery, one-use tokens, expiry, revocation and API limits", {
  skip: !fs.existsSync(binary), timeout: 120000
}, async (t) => {
  // Always launch our own local database. Never read application .env or MONGO_URI.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "password-recovery-test-"));
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(binary, ["--bind_ip", "127.0.0.1", "--port", String(port), "--dbpath", directory, "--quiet"], { windowsHide: true, stdio: "ignore" });
  let server;
  try {
    process.env.NODE_ENV = "test";
    process.env.MONGO_URI = `mongodb://127.0.0.1:${port}/password_recovery_test`;
    process.env.JWT_SECRET = "isolated-recovery-test-key";
    process.env.EMAIL_ENABLED = "true";
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "test-only-never-sent";
    process.env.EMAIL_FROM = "test@example.com";
    process.env.PASSWORD_RESET_SITE_URL = "https://zanzibartoursandsafaris.co.tz";
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 30000 });
    assert.equal(mongoose.connection.name, "password_recovery_test");
    const User = require("../src/models/User");
    const { authenticate } = require("../src/middleware/auth");
    const authService = require("../src/services/auth");
    const sent = [];
    let time = new Date("2026-09-24T12:00:00Z");
    let failMail = false;
    const failureLogs = [];
    const settings = {
      User, configured: true, siteUrl: process.env.PASSWORD_RESET_SITE_URL,
      now: () => time,
      sendEmail: async (message) => { if (failMail) throw new Error("sensitive provider body"); sent.push(message); },
      logFailure: (...args) => failureLogs.push(args)
    };
    const service = createPasswordRecovery(settings);
    const email = "owner@example.com";
    const original = "Original password 123";
    const changed = "  Replacement password 456  ";
    const user = await User.create({ email, firstName: "Test", lastName: "Owner", password: original, role: "super_admin" });
    const tokenFromLastEmail = () => new URLSearchParams(new URL(sent.at(-1).resetUrl).hash.slice(1)).get("token");
    const advance = (ms = 61000) => { time = new Date(time.getTime() + ms); };
    const authCheck = (token) => new Promise((resolve) => authenticate({ headers: { authorization: `Bearer ${token}` } }, {}, (error) => resolve(error)));
    let initialToken;

    await t.test("existing, unknown, inactive and throttled requests do not disclose account existence", async () => {
      const inactive = await User.create({ email: "inactive@example.com", firstName: "Test", lastName: "Inactive", password: original, role: "admin", isActive: false });
      const unknown = await service.requestReset({ email: "unknown@example.com" });
      const disabled = await service.requestReset({ email: inactive.email });
      const valid = await service.requestReset({ email: " OWNER@EXAMPLE.COM " });
      const throttled = await service.requestReset({ email });
      assert.deepEqual(valid, unknown);
      assert.deepEqual(valid, disabled);
      assert.deepEqual(valid, throttled);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to, email);
      assert.equal(new URL(sent[0].resetUrl).origin, settings.siteUrl);
      assert.equal(new URL(sent[0].resetUrl).search, "");
      initialToken = tokenFromLastEmail();
      const stored = await User.findById(user._id).select("+passwordResetHash +passwordResetExpiresAt").lean();
      assert.notEqual(stored.passwordResetHash, initialToken);
      assert.equal(stored.passwordResetHash, crypto.createHash("sha256").update(initialToken).digest("hex"));
      assert.equal(stored.passwordResetExpiresAt.getTime() - time.getTime(), 30 * 60000);
      assert.ok(!JSON.stringify(valid).includes(initialToken));
    });

    await t.test("new link replaces older link; expired token cannot change password", async () => {
      advance();
      await service.requestReset({ email });
      await assert.rejects(service.resetPassword({ token: initialToken, password: changed }), { code: "RESET_LINK_INVALID" });
      const expiring = tokenFromLastEmail();
      advance(30 * 60000);
      await assert.rejects(service.resetPassword({ token: expiring, password: changed }), { code: "RESET_LINK_INVALID" });
      assert.ok(await (await User.findById(user._id).select("+password")).comparePassword(original));
    });

    await t.test("concurrent use succeeds once; old password and old sessions fail", async () => {
      advance();
      const oldSession = await authService.login({ email, password: original });
      const legacyToken = jwt.sign({ sub: String(user._id), userType: "user", role: "super_admin" }, process.env.JWT_SECRET);
      assert.equal(await authCheck(legacyToken), undefined);
      await service.requestReset({ email });
      const token = tokenFromLastEmail();
      const results = await Promise.allSettled([service.resetPassword({ token, password: changed }), service.resetPassword({ token, password: changed })]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.find((result) => result.status === "rejected").reason.code, "RESET_LINK_INVALID");
      const saved = await User.findById(user._id).select("+password +passwordResetHash").lean();
      assert.ok(await bcrypt.compare(changed, saved.password));
      assert.equal(saved.tokenVersion, 1);
      assert.equal(saved.passwordResetHash, undefined);
      assert.equal(saved.role, "super_admin");
      assert.equal(saved.email, email);
      await assert.rejects(authService.login({ email, password: original }), { code: "INVALID_CREDENTIALS" });
      assert.equal((await authCheck(oldSession.token)).code, "INVALID_TOKEN");
      assert.equal((await authCheck(legacyToken)).code, "INVALID_TOKEN");
      const fresh = await authService.login({ email, password: changed });
      assert.equal(await authCheck(fresh.token), undefined);
    });

    await t.test("disabled account and malformed token cannot reset; delivery failures clear token safely", async () => {
      advance();
      await service.requestReset({ email });
      const token = tokenFromLastEmail();
      await User.updateOne({ _id: user._id }, { $set: { isActive: false } });
      await assert.rejects(service.resetPassword({ token, password: changed }), { code: "RESET_LINK_INVALID" });
      await assert.rejects(service.resetPassword({ token: "bad", password: changed }), { code: "RESET_LINK_INVALID" });
      await User.updateOne({ _id: user._id }, { $set: { isActive: true } });
      advance();
      failMail = true;
      const failed = await service.requestReset({ email });
      assert.match(failed.message, /^If an active/);
      assert.deepEqual(failureLogs, [[]]);
      assert.equal((await User.findById(user._id).select("+passwordResetHash").lean()).passwordResetHash, undefined);
      failMail = false;
    });

    await t.test("unconfigured email and untrusted reset origins fail before account lookup", async () => {
      const neverQuery = { findOneAndUpdate() { assert.fail("Must not query accounts"); } };
      for (const override of [{ configured: false }, { siteUrl: "http://evil.example" }, { siteUrl: "https://good.example@evil.example" }]) {
        await assert.rejects(createPasswordRecovery({ ...settings, ...override, User: neverQuery }).requestReset({ email }), { code: "RECOVERY_UNAVAILABLE" });
      }
    });

    await t.test("HTTP recovery routes: validation, generic response, no-store, per-IP limit and real email template", async () => {
      const axios = require("axios");
      const originalPost = axios.post;
      const messages = [];
      axios.post = async (url, body) => { assert.equal(url, "https://api.resend.com/emails"); messages.push(body); return { data: { id: "test-email-id" } }; };
      try {
        const express = require("express");
        const app = express();
        app.use(express.json());
        app.use(sanitizePayload);
        app.use("/auth", require("../src/routes/auth.routes"));
        app.use(require("../src/middleware/errorHandler"));
        server = app.listen(0, "127.0.0.1");
        await once(server, "listening");
        const base = `http://127.0.0.1:${server.address().port}/auth`;
        const post = (route, body) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        await User.updateOne({ _id: user._id }, { $unset: { passwordResetRequestedAt: 1 } });
        const request = await post("/forgot-password", { email });
        assert.equal(request.status, 200);
        assert.equal(request.headers.get("cache-control"), "no-store");
        assert.equal(messages.length, 1);
        const token = messages[0].html.match(/#token=([a-f0-9]{64})/)[1];
        assert.ok(!JSON.stringify(await request.json()).includes(token));
        assert.equal((await post("/forgot-password", { email: "not-an-email" })).status, 422);
        assert.equal((await post("/reset-password", { token, password: "short" })).status, 422);
        assert.equal((await post("/reset-password", { token, password: changed })).status, 200);
        const loggedIn = await post("/login", { email, password: changed, portal: "admin" });
        assert.equal(loggedIn.status, 200);
        assert.equal((await post("/reset-password", { token, password: changed })).status, 400);
        for (let i = 0; i < 5; i++) assert.equal((await post("/forgot-password", { email: "nobody@example.com" })).status, 200);
        assert.equal((await post("/forgot-password", { email })).status, 429);
      } finally {
        axios.post = originalPost;
      }
    });
    await t.test("admin creation requires super admin and creates a usable hashed-password account", async () => {
      const base = `http://127.0.0.1:${server.address().port}/auth`;
      const post = (body, token) => fetch(base + "/register-admin", {
        method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body)
      });
      const payload = { firstName: "New", lastName: "Administrator", email: "NEW.ADMIN@example.com", password: "NewAdmin-Test!12345", role: "admin" };
      assert.equal((await post(payload)).status, 403);
      const owner = await authService.login({ email, password: changed });
      const response = await post(payload, owner.token);
      assert.equal(response.status, 201);
      const result = await response.json();
      assert.equal(result.data.email, "new.admin@example.com");
      assert.equal(result.data.role, "admin");
      assert.ok(!JSON.stringify(result).includes(payload.password));
      const saved = await User.findOne({ email: "new.admin@example.com" }).select("+password");
      assert.notEqual(saved.password, payload.password);
      assert.ok(await saved.comparePassword(payload.password));
      const admin = await authService.login({ email: "new.admin@example.com", password: payload.password });
      assert.equal((await post({ ...payload, email: "unauthorized@example.com" }, admin.token)).status, 403);
      assert.equal((await post(payload, owner.token)).status, 409);
      const staff = await User.create({ firstName: "Test", lastName: "Staff", email: "staff@example.com", password: payload.password, role: "staff" });
      const staffToken = authService.signToken({ id: String(staff._id), role: "staff", userType: "user" });
      assert.equal((await post({ ...payload, email: "staff-created@example.com" }, staffToken)).status, 403);
      assert.equal(await User.countDocuments({ email: { $in: ["unauthorized@example.com", "staff-created@example.com"] } }), 0);
      assert.equal(await authCheck(owner.token), undefined);
    });
    const collections = (await mongoose.connection.db.listCollections().toArray()).map((item) => item.name);
    assert.deepEqual(collections, ["users"]);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (child.exitCode === null) { child.kill(); await once(child, "exit"); }
    // Delete only the unique temporary directory created by this test.
    const resolved = fs.realpathSync(directory);
    const tempRoot = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved), tempRoot);
    assert.ok(path.basename(resolved).startsWith("password-recovery-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
