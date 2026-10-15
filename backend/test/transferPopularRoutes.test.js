// Popular transfer routes against a real MongoDB, using a throwaway database that is dropped afterwards. Skipped when
// no MongoDB is reachable on 127.0.0.1:27017 (for example in CI).
const TEST_DB = `rt_popular_${process.pid}`;
process.env.NODE_ENV = "test";
process.env.MONGO_URI = `mongodb://127.0.0.1:27017/business_platform_test_${process.pid}`;
process.env.JWT_SECRET = "business-platform-test-secret-0123456789";
process.env.TRANSFERS_MONGO_URI = "mongodb://127.0.0.1:27017";
process.env.TRANSFERS_DB_NAME = TEST_DB;
process.env.TRANSFER_JWT_SECRET = "transfer-admin-test-secret-0123456789abcdef";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const mongoose = require("mongoose");

const errorHandler = require("../src/middleware/errorHandler");
const { getTransferStore, closeTransferStore } = require("../src/transfers/db/connection");
const { createTransferServices, createTransferAdminApi, createTransferPublicApi } = require("../src/transfers");

const PASSWORD = "Popular-Routes-Passw0rd";
const gateway = { configured: () => false };

const mongoReachable = async () => {
  const probe = mongoose.createConnection("mongodb://127.0.0.1:27017/admin", { serverSelectionTimeoutMS: 1500 });
  try {
    await probe.asPromise();
    return true;
  } catch (_error) {
    return false;
  } finally {
    await probe.close().catch(() => {});
  }
};

test("popular transfer routes against a real database", async (t) => {
  if (!(await mongoReachable())) {
    t.skip("MongoDB is not reachable on 127.0.0.1:27017");
    return;
  }
  const app = express();
  app.use(express.json());
  app.use("/api/transfers", createTransferPublicApi({ gateway }));
  app.use("/api/transfer-admin", createTransferAdminApi({ gateway }));
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, { token, body } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const json = await response.json().catch(() => null);
    return { status: response.status, data: json?.data, code: json?.error?.code };
  };

  try {
    const store = await getTransferStore();
    const services = createTransferServices({ gateway });
    await services.auth.createFirstAdmin({ name: "Admin", email: "admin@example.test", password: PASSWORD });
    const login = async (email) => (await call("POST", "/transfer-admin/auth/login", { body: { email, password: PASSWORD } })).data.token;
    const admin = await login("admin@example.test");
    await call("POST", "/transfer-admin/users", { token: admin, body: { name: "Manager", email: "manager@example.test", role: "transfer_manager", password: PASSWORD } });
    const manager = await login("manager@example.test");

    const actor = { id: "", email: "setup", role: "transfer_admin" };
    const { catalog } = services;
    const zoneA = await catalog.createZone({ actor, input: { code: "APT", name: "Airport" } });
    const zoneB = await catalog.createZone({ actor, input: { code: "NTH", name: "North" } });
    const zoneC = await catalog.createZone({ actor, input: { code: "STH", name: "South" } });
    const airport = await catalog.createLocation({ actor, input: { name: "Airport", type: "AIRPORT", zoneId: zoneA.id } });
    const nungwi = await catalog.createLocation({ actor, input: { name: "Nungwi", type: "AREA", zoneId: zoneB.id } });
    const south = await catalog.createLocation({ actor, input: { name: "Kizimkazi", type: "AREA", zoneId: zoneC.id } });
    const closed = await catalog.createLocation({ actor, input: { name: "Closed beach", type: "AREA", zoneId: zoneB.id, active: false } });
    const route = await catalog.createRoute({ actor, input: { fromZoneId: zoneA.id, toZoneId: zoneB.id, bidirectional: true, durationMinutes: 75 } });
    await catalog.createRate({ actor, input: { routeId: route.id, minPassengers: 6, maxPassengers: 14, price: "70" } });
    await catalog.createRate({ actor, input: { routeId: route.id, minPassengers: 1, maxPassengers: 5, price: "50" } });
    await catalog.createRoute({ actor, input: { fromZoneId: zoneA.id, toZoneId: zoneC.id, bidirectional: true } });

    const create = (body, token = admin) => call("POST", "/transfer-admin/popular-routes", { token, body });
    const ctx = {};

    await t.test("only staff who manage pricing create popular routes, and a route never carries a price", async () => {
      const body = { slug: "airport-to-nungwi", title: "Zanzibar Airport to Nungwi", pickupLocationId: airport.id, dropoffLocationId: nungwi.id, displayOrder: 20 };
      assert.equal((await create(body, manager)).status, 403);
      assert.equal((await create({ ...body, price: "35" })).status, 422, "a price cannot be stored on the product");
      assert.equal((await create({ ...body, dropoffLocationId: airport.id })).code, "TRANSFER_SAME_LOCATION");
      const created = await create(body);
      assert.equal(created.status, 201);
      assert.deepEqual(created.data.inclusions, ["PRIVATE_VEHICLE"], "only the private vehicle is claimed until staff add more");
      ctx.nungwi = created.data;
      assert.equal((await create(body)).status, 409, "slugs are unique");
      await create({ slug: "nungwi-to-airport", title: "Nungwi to Zanzibar Airport", pickupLocationId: nungwi.id, dropoffLocationId: airport.id, displayOrder: 30 });
      await create({ slug: "airport-to-kizimkazi", title: "Zanzibar Airport to Kizimkazi", pickupLocationId: airport.id, dropoffLocationId: south.id, displayOrder: 10 });
      await create({ slug: "airport-to-closed", title: "Airport to a closed beach", pickupLocationId: airport.id, dropoffLocationId: closed.id, displayOrder: 40 });
      assert.equal(await store.models.AuditLog.countDocuments({ action: "popular_route.created" }), 4);
    });

    await t.test("the website gets bookable routes in order, priced from the lowest rate, or Price on Request", async () => {
      const result = await call("GET", "/transfers/popular-routes");
      assert.equal(result.status, 200);
      assert.deepEqual(result.data.map((item) => item.slug), ["airport-to-kizimkazi", "airport-to-nungwi", "nungwi-to-airport"], "inactive places are never offered");
      const [quote, outbound, back] = result.data;
      assert.deepEqual(quote.price, { status: "QUOTE_REQUIRED", from: null, currency: "USD", basis: "PER_VEHICLE" });
      assert.deepEqual(outbound.price, { status: "PRICED", from: "50.00", currency: "USD", basis: "PER_VEHICLE" });
      assert.equal(back.price.from, "50.00", "a bidirectional route prices both directions");
      assert.equal(outbound.durationMinutes, 75);
      assert.equal(quote.durationMinutes, null, "no duration is invented");
      assert.deepEqual(outbound.pickup, { id: airport.id, name: "Airport", type: "AIRPORT" });
      assert.equal(outbound.tripType, "ONE_WAY");

      // The card price is the price a one-passenger search gets from the pricing engine.
      const engine = await services.pricing.quote({ tripType: "ONE_WAY", pickupLocationId: airport.id, dropoffLocationId: nungwi.id, passengers: { adults: 1 } });
      assert.equal(engine.total, outbound.price.from);
    });

    await t.test("staff hide, reorder and change inclusions without touching prices; changes are audited", async () => {
      const updated = await call("PATCH", `/transfer-admin/popular-routes/${ctx.nungwi.id}`, { token: admin, body: { displayOrder: 1, inclusions: ["PRIVATE_VEHICLE", "PROFESSIONAL_DRIVER"], reason: "Confirmed with operations" } });
      assert.equal(updated.status, 200);
      let list = (await call("GET", "/transfers/popular-routes")).data;
      assert.equal(list[0].slug, "airport-to-nungwi");
      assert.deepEqual(list[0].inclusions, ["PRIVATE_VEHICLE", "PROFESSIONAL_DRIVER"]);
      await call("PATCH", `/transfer-admin/popular-routes/${ctx.nungwi.id}`, { token: admin, body: { active: false } });
      list = (await call("GET", "/transfers/popular-routes")).data;
      assert.equal(list.some((item) => item.slug === "airport-to-nungwi"), false);
      assert.equal((await call("GET", "/transfer-admin/popular-routes", { token: manager })).data.length, 4, "staff still see hidden routes");
      assert.equal((await call("PATCH", `/transfer-admin/popular-routes/${ctx.nungwi.id}`, { token: manager, body: { active: true } })).status, 403);
      const log = await store.models.AuditLog.findOne({ action: "popular_route.updated", reason: "Confirmed with operations" }).lean();
      assert.ok(log);
      assert.equal(await store.models.Rate.countDocuments({ price: { $in: [mongoose.Types.Decimal128.fromString("35")] } }), 0, "no price rule was created");
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    const store = await getTransferStore().catch(() => null);
    if (store) await store.connection.dropDatabase().catch(() => {});
    await closeTransferStore();
    await mongoose.disconnect().catch(() => {});
  }
});
