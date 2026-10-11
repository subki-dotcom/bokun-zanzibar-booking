process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/business_platform_test";
process.env.JWT_SECRET = "business-platform-test-secret-0123456789";
process.env.TRANSFER_JWT_SECRET = "transfer-admin-test-secret-0123456789abcdef";
// No transfer database configured in this file: the Transfer System must report itself unavailable.
process.env.TRANSFERS_MONGO_URI = "";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const { configurationProblems } = require("../src/transfers/config");
const { evaluatePrivileges } = require("../src/transfers/db/privileges");
const { signTransferToken, verifyTransferToken } = require("../src/transfers/security/tokens");
const { passwordSchema } = require("../src/transfers/security/password");
const { TRANSFER_PERMISSIONS: P, TRANSFER_ROLES: R, permissionsForTransferRole } = require("../src/transfers/security/permissions");

const TRANSFER_SECRET = process.env.TRANSFER_JWT_SECRET;
const BUSINESS_SECRET = process.env.JWT_SECRET;

const withServer = async (fn) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

test("each Transfer Admin role holds only its agreed permissions, and Back Office roles hold none", () => {
  assert.deepEqual(permissionsForTransferRole(R.ADMIN).sort(), Object.values(P).sort());
  const manager = permissionsForTransferRole(R.MANAGER);
  for (const denied of [P.PRICING_MANAGE, P.USERS_MANAGE, P.AUDIT_VIEW, P.PAYMENTS_MANAGE, P.REFUNDS_APPROVE]) assert.equal(manager.includes(denied), false, denied);
  assert.ok(manager.includes(P.BOOKINGS_MANAGE) && manager.includes(P.DISPATCH_MANAGE) && manager.includes(P.FLEET_MANAGE));
  assert.deepEqual(permissionsForTransferRole(R.DISPATCHER).sort(), [P.BOOKINGS_VIEW, P.DISPATCH_MANAGE, P.FLEET_VIEW].sort());
  const accountant = permissionsForTransferRole(R.ACCOUNTANT);
  for (const denied of [P.DISPATCH_MANAGE, P.FLEET_MANAGE, P.PRICING_MANAGE, P.USERS_MANAGE, P.BOOKINGS_MANAGE]) assert.equal(accountant.includes(denied), false, denied);
  assert.ok(accountant.includes(P.PAYMENTS_MANAGE) && accountant.includes(P.REPORTS_VIEW));
  for (const backOfficeRole of ["super_admin", "admin", "staff", "agent"]) assert.deepEqual(permissionsForTransferRole(backOfficeRole), []);
});

test("the Transfer System refuses configurations that would share the Business Platform database or secret", () => {
  const good = {
    NODE_ENV: "production",
    MONGO_URI: "mongodb+srv://business_app:pw@cluster.example.net/bokun_zanzibar_booking",
    JWT_SECRET: BUSINESS_SECRET,
    TRANSFERS_MONGO_URI: "mongodb+srv://riser_transfers_app:pw@cluster.example.net/riser_transfers?authSource=riser_transfers",
    TRANSFERS_DB_NAME: "riser_transfers",
    TRANSFER_JWT_SECRET: TRANSFER_SECRET
  };
  assert.deepEqual(configurationProblems(good), []);
  const problems = (overrides) => configurationProblems({ ...good, ...overrides }).join(" | ");
  assert.match(problems({ TRANSFERS_MONGO_URI: "" }), /TRANSFERS_MONGO_URI is not set/);
  assert.match(problems({ TRANSFERS_DB_NAME: "bokun_zanzibar_booking" }), /must differ from the Business Platform database/);
  assert.match(problems({ TRANSFER_JWT_SECRET: "short" }), /at least 32 characters/);
  assert.match(problems({ TRANSFER_JWT_SECRET: BUSINESS_SECRET.padEnd(40, "x"), JWT_SECRET: BUSINESS_SECRET.padEnd(40, "x") }), /must differ from JWT_SECRET/);
  assert.match(problems({ TRANSFERS_MONGO_URI: "mongodb+srv://cluster.example.net/riser_transfers" }), /its own database credentials/);
  assert.match(problems({ TRANSFERS_MONGO_URI: "mongodb+srv://business_app:pw@cluster.example.net/riser_transfers" }), /must not reuse the Business Platform database user/);
  // Local development may use an unauthenticated local server.
  assert.deepEqual(configurationProblems({ ...good, NODE_ENV: "development", TRANSFERS_MONGO_URI: "mongodb://127.0.0.1:27017" }), []);
});

test("the transfer database user may hold privileges on the transfer database only", () => {
  const scope = { transfersDb: "riser_transfers", businessDb: "bokun_zanzibar_booking" };
  const status = (roles, privileges) => ({
    authInfo: { authenticatedUsers: [{ user: "riser_transfers_app", db: "riser_transfers" }], authenticatedUserRoles: roles, authenticatedUserPrivileges: privileges }
  });
  const readWrite = status([{ role: "readWrite", db: "riser_transfers" }], [{ resource: { db: "riser_transfers", collection: "" }, actions: ["find", "insert"] }]);
  assert.equal(evaluatePrivileges(readWrite, { ...scope, nodeEnv: "production" }).ok, true);

  const business = status(
    [{ role: "readWrite", db: "riser_transfers" }, { role: "read", db: "bokun_zanzibar_booking" }],
    [{ resource: { db: "bokun_zanzibar_booking", collection: "" }, actions: ["find"] }]
  );
  const result = evaluatePrivileges(business, scope);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(" | "), /Business Platform database/);

  const anyDatabase = status([{ role: "readWriteAnyDatabase", db: "admin" }], [{ resource: { db: "", collection: "" }, actions: ["find"] }]);
  assert.equal(evaluatePrivileges(anyDatabase, scope).ok, false);
  const cluster = status([{ role: "readWrite", db: "riser_transfers" }], [{ resource: { cluster: true }, actions: ["listDatabases"] }]);
  assert.equal(evaluatePrivileges(cluster, scope).ok, false);

  const unauthenticated = { authInfo: { authenticatedUsers: [], authenticatedUserRoles: [] } };
  assert.equal(evaluatePrivileges(unauthenticated, { ...scope, nodeEnv: "production" }).ok, false);
  const local = evaluatePrivileges(unauthenticated, { ...scope, nodeEnv: "development" });
  assert.equal(local.ok, true);
  assert.equal(local.warnings.length, 1);
});

test("Transfer Admin and Business Platform tokens are not interchangeable", () => {
  const user = { _id: "507f1f77bcf86cd799439011", role: R.ADMIN, tokenVersion: 0 };
  const transferToken = signTransferToken(user, { secret: TRANSFER_SECRET, expiresIn: "5m" });
  assert.equal(verifyTransferToken(transferToken, { secret: TRANSFER_SECRET }).sub, user._id);
  assert.throws(() => jwt.verify(transferToken, BUSINESS_SECRET));

  const businessToken = jwt.sign({ sub: user._id, userType: "user" }, BUSINESS_SECRET, { expiresIn: "5m" });
  assert.throws(() => verifyTransferToken(businessToken, { secret: TRANSFER_SECRET }));
  // Even signed with the transfer secret, a token for another audience or without the type is refused.
  const wrongAudience = jwt.sign({ typ: "transfer_admin" }, TRANSFER_SECRET, { subject: user._id, issuer: "riser-transfers", audience: "back-office" });
  assert.throws(() => verifyTransferToken(wrongAudience, { secret: TRANSFER_SECRET }));
  const untyped = jwt.sign({}, TRANSFER_SECRET, { subject: user._id, issuer: "riser-transfers", audience: "riser-transfer-admin" });
  assert.throws(() => verifyTransferToken(untyped, { secret: TRANSFER_SECRET }));
  const none = jwt.sign({ typ: "transfer_admin" }, "", { algorithm: "none", subject: user._id, issuer: "riser-transfers", audience: "riser-transfer-admin" });
  assert.throws(() => verifyTransferToken(none, { secret: TRANSFER_SECRET }));
});

test("over HTTP, each side rejects the other's token and an unconfigured Transfer System is unavailable", async () => {
  await withServer(async (base) => {
    const transferToken = signTransferToken({ _id: "507f1f77bcf86cd799439011", role: R.ADMIN }, { secret: TRANSFER_SECRET, expiresIn: "5m" });
    const businessToken = jwt.sign({ sub: "507f1f77bcf86cd799439011", userType: "user" }, BUSINESS_SECRET, { expiresIn: "5m" });
    const get = (path, token) => fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

    const backOfficeWithTransferToken = await get("/api/auth/me", transferToken);
    assert.equal(backOfficeWithTransferToken.status, 401);
    const transferWithBusinessToken = await get("/api/transfer-admin/auth/me", businessToken);
    assert.equal(transferWithBusinessToken.status, 401);
    assert.equal((await transferWithBusinessToken.json()).error.code, "TRANSFER_INVALID_TOKEN");
    assert.equal((await get("/api/transfer-admin/zones")).status, 401);

    const login = await fetch(`${base}/api/transfer-admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "someone@example.test", password: "whatever" })
    });
    assert.equal(login.status, 503);
    assert.equal((await login.json()).error.code, "TRANSFER_SERVICE_UNAVAILABLE");
  });
});

test("Transfer Admin passwords need 12+ characters with upper case, lower case and a number", () => {
  assert.equal(passwordSchema.safeParse("Short1A").success, false);
  assert.equal(passwordSchema.safeParse("alllowercase123").success, false);
  assert.equal(passwordSchema.safeParse("NoNumbersHereAtAll").success, false);
  assert.equal(passwordSchema.safeParse("A".repeat(40) + "a1".repeat(20)).success, false);
  assert.equal(passwordSchema.safeParse("Good-Transfer-Passw0rd").success, true);
});
