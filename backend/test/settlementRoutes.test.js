process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/settlement-routes-test";
process.env.JWT_SECRET ||= "settlement-routes-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const User = require("../src/models/User");
const settlementService = require("../src/services/settlements");
const { PERMISSIONS, hasPermission } = require("../src/security/permissions");

const userId = "66cccccccccccccccccccccc";
const token = () => jwt.sign({ sub: userId, userType: "user" }, process.env.JWT_SECRET, { expiresIn: "5m" });
const mockUser = (role = "admin") => { const original = User.findById; User.findById = () => ({ lean: async () => ({ _id: { toString: () => userId }, role, isActive: true, email: `${role}@example.test` }) }); return () => { User.findById = original; }; };
const listen = async () => { const server = http.createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); return server; };
const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

test("settlement permissions enforce least privilege", () => {
  assert.equal(hasPermission({ role: "staff" }, PERMISSIONS.SETTLEMENT_VIEW), true);
  assert.equal(hasPermission({ role: "staff" }, PERMISSIONS.SETTLEMENT_CREATE), true);
  assert.equal(hasPermission({ role: "agent" }, PERMISSIONS.SETTLEMENT_VIEW), false);
  assert.equal(hasPermission({ role: "agent" }, PERMISSIONS.SETTLEMENT_CREATE), false);
});

test("settlement list is authorized and create is provider-neutral", async () => {
  const restore = mockUser("admin");
  const originalList = settlementService.list;
  const originalCreate = settlementService.create;
  settlementService.list = async () => ({ items: [], page: 1, pageSize: 25, total: 0, totalPages: 1 });
  settlementService.create = async ({ input }) => ({ replay: false, settlement: { settlementReference: input.settlementReference, provider: input.provider } });
  const server = await listen();
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/admin/settlements`;
    assert.equal((await fetch(base)).status, 401);
    const list = await fetch(base, { headers: { Authorization: `Bearer ${token()}` } });
    assert.equal(list.status, 200);
    const create = await fetch(base, { method: "POST", headers: { Authorization: `Bearer ${token()}`, "content-type": "application/json" }, body: JSON.stringify({ settlementReference: "S-1", provider: "VIATOR", evidenceSource: "MANUAL_VERIFIED", evidenceReference: "statement-1" }) });
    assert.equal(create.status, 200);
    assert.equal((await create.json()).data.settlement.provider, "VIATOR");
  } finally { settlementService.list = originalList; settlementService.create = originalCreate; restore(); await close(server); }
});

test("settlement import preview route is permission protected", async () => {
  const restore = mockUser("agent");
  const server = await listen();
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/settlements/import/preview`, { method: "POST", headers: { Authorization: `Bearer ${token()}`, "content-type": "application/json" }, body: JSON.stringify({ csv: "settlement_reference,provider,amount,currency,evidence_reference\nS-1,BANK,10,USD,E-1" }) });
    assert.equal(response.status, 403);
  } finally { restore(); await close(server); }
});
