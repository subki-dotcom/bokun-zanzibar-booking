// Admin Settings: the overview never returns secrets, the test email goes through SMTP, and password changes check
// the current password. The HTTP part needs MY_BOOKING_TEST_MONGO_URI (a throwaway database).
process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27018/unused";
process.env.JWT_SECRET ||= "admin-settings-test-secret";
process.env.SMTP_PASS = "super-secret-smtp-password";
process.env.TURNSTILE_SECRET_KEY = "turnstile-secret-value";
process.env.BOKUN_SECRET_KEY = "bokun-secret-value";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const smtp = require("../src/services/email/smtp");
const adminSettings = require("../src/services/adminSettings");

test("the overview says what is set up without returning any secret", () => {
  const overview = adminSettings.getOverview();
  const text = JSON.stringify(overview);
  for (const secret of ["super-secret-smtp-password", "turnstile-secret-value", "bokun-secret-value"]) {
    assert.ok(!text.includes(secret), `leaked ${secret}`);
  }
  assert.equal(overview.security.turnstile, true);
  assert.equal(overview.company.brandName, "Zanzibar Tours & Safaris");
  assert.ok(Array.isArray(overview.payments));
});

test("the test email goes to the signed-in admin through SMTP", async (t) => {
  const sent = [];
  smtp.setTransportForTests({ sendMail: async (message) => (sent.push(message), { messageId: "<t@local>" }) });
  t.after(() => smtp.setTransportForTests(null));
  assert.deepEqual(await adminSettings.sendTestEmail({ to: "owner@example.test" }), { sentTo: "owner@example.test" });
  assert.equal(sent[0].to, "owner@example.test");
  assert.match(sent[0].subject, /test email/);
});

test("an SMTP refusal is reported without server details", async (t) => {
  smtp.setTransportForTests({ sendMail: async () => { throw new Error("535 Authentication failed for smtp.secret.test"); } });
  t.after(() => smtp.setTransportForTests(null));
  await assert.rejects(adminSettings.sendTestEmail({ to: "owner@example.test" }), (error) =>
    error.code === "SETTINGS_TEST_EMAIL_FAILED" && !/535|secret/.test(error.message));
});

const MONGO = process.env.MY_BOOKING_TEST_MONGO_URI;
test("HTTP: settings need an admin; change password checks the current one", { skip: !MONGO }, async (t) => {
  const app = require("../src/app");
  const User = require("../src/models/User");
  const { signToken } = require("../src/services/auth");
  await mongoose.connect(MONGO, { dbName: `settings_test_${process.pid}_${crypto.randomBytes(4).toString("hex")}` });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  const admin = await User.create({ firstName: "Owner", lastName: "Admin", email: "owner@example.test", password: "Old-password-1", role: "super_admin" });
  const token = signToken({ id: String(admin._id), role: admin.role, userType: "user" });
  const call = (method, path, body, auth = token) =>
    fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    }).then(async (response) => ({ status: response.status, json: await response.json() }));

  assert.equal((await call("GET", "/admin/settings", null, "")).status, 401);
  const overview = await call("GET", "/admin/settings");
  assert.equal(overview.status, 200);
  assert.ok(!JSON.stringify(overview.json).includes("super-secret-smtp-password"));

  const wrong = await call("POST", "/auth/change-password", { currentPassword: "nope-nope", newPassword: "New-password-2" });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.error.code, "CURRENT_PASSWORD_INVALID");
  const short = await call("POST", "/auth/change-password", { currentPassword: "Old-password-1", newPassword: "short" });
  assert.equal(short.status, 422);
  const ok = await call("POST", "/auth/change-password", { currentPassword: "Old-password-1", newPassword: "New-password-2" });
  assert.equal(ok.status, 200);
  const login = await call("POST", "/auth/login", { email: "owner@example.test", password: "New-password-2" }, "");
  assert.equal(login.status, 200);
});
