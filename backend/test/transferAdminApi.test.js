// Transfer Admin API end to end against a real MongoDB, using a throwaway database that is dropped afterwards.
// Skipped when no MongoDB is reachable on 127.0.0.1:27017 (for example in CI).
const TEST_DB = `riser_transfers_test_${process.pid}`;
process.env.NODE_ENV = "test";
process.env.MONGO_URI = `mongodb://127.0.0.1:27017/business_platform_test_${process.pid}`;
process.env.JWT_SECRET = "business-platform-test-secret-0123456789";
process.env.TRANSFERS_MONGO_URI = "mongodb://127.0.0.1:27017";
process.env.TRANSFERS_DB_NAME = TEST_DB;
process.env.TRANSFER_JWT_SECRET = "transfer-admin-test-secret-0123456789abcdef";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const mongoose = require("mongoose");

const app = require("../src/app");
const { getTransferStore, closeTransferStore } = require("../src/transfers/db/connection");
const { createTransferServices } = require("../src/transfers");

const PASSWORDS = {
  admin: "Admin-Transfer-Passw0rd",
  manager: "Manager-Transfer-Passw0rd",
  dispatcher: "Dispatch-Transfer-Passw0rd",
  accountant: "Account-Transfer-Passw0rd"
};

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

test("Transfer Admin API against a real database", async (t) => {
  if (!(await mongoReachable())) {
    t.skip("MongoDB is not reachable on 127.0.0.1:27017");
    return;
  }

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/transfer-admin`;
  const call = async (method, path, { token, body } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, json, data: json?.data, code: json?.error?.code };
  };
  const login = async (email, password) => call("POST", "/auth/login", { body: { email, password } });

  try {
    const store = await getTransferStore();
    await createTransferServices().auth.createFirstAdmin({ name: "First Admin", email: "admin@example.test", password: PASSWORDS.admin });
    const ctx = {};

    await t.test("data lives in its own database, never the Business Platform database", async () => {
      assert.equal(store.connection.db.databaseName, TEST_DB);
      assert.notEqual(TEST_DB, new URL(process.env.MONGO_URI).pathname.slice(1));
      const collections = (await store.connection.db.listCollections().toArray()).map((item) => item.name);
      assert.ok(collections.includes("transfer_admin_users"));
      assert.ok(collections.includes("transfer_audit_logs"));
      await assert.rejects(() => createTransferServices().auth.createFirstAdmin({ name: "Second", email: "x@example.test", password: PASSWORDS.admin }), (error) => error.code === "TRANSFER_ADMIN_ALREADY_SEEDED");
    });

    await t.test("an admin signs in and gets their profile and permissions", async () => {
      const result = await login("ADMIN@example.test", PASSWORDS.admin);
      assert.equal(result.status, 200);
      assert.equal(result.data.user.role, "transfer_admin");
      assert.equal(result.data.user.passwordHash, undefined);
      ctx.admin = result.data.token;
      const me = await call("GET", "/auth/me", { token: ctx.admin });
      assert.equal(me.status, 200);
      assert.ok(me.data.permissions.includes("transfer.pricing.manage"));
    });

    await t.test("users of each role can be created, and passwords follow the policy", async () => {
      const weak = await call("POST", "/users", { token: ctx.admin, body: { name: "Weak", email: "weak@example.test", role: "dispatcher", password: "weak" } });
      assert.equal(weak.status, 422);
      for (const [key, role] of [["manager", "transfer_manager"], ["dispatcher", "dispatcher"], ["accountant", "transfer_accountant"]]) {
        const created = await call("POST", "/users", { token: ctx.admin, body: { name: key, email: `${key}@example.test`, role, password: PASSWORDS[key] } });
        assert.equal(created.status, 201, key);
        ctx[`${key}Id`] = created.data.id;
        ctx[key] = (await login(`${key}@example.test`, PASSWORDS[key])).data.token;
      }
      const duplicate = await call("POST", "/users", { token: ctx.admin, body: { name: "Dup", email: "manager@example.test", role: "dispatcher", password: PASSWORDS.manager } });
      assert.equal(duplicate.status, 409);
    });

    await t.test("only admins manage pricing; managers and accountants view it; dispatchers do not", async () => {
      assert.equal((await call("POST", "/zones", { token: ctx.manager, body: { code: "X", name: "X" } })).status, 403);
      assert.equal((await call("GET", "/zones", { token: ctx.manager })).status, 200);
      assert.equal((await call("GET", "/rates", { token: ctx.accountant })).status, 200);
      assert.equal((await call("GET", "/zones", { token: ctx.dispatcher })).status, 403);
      assert.equal((await call("GET", "/users", { token: ctx.manager })).status, 403);
      assert.equal((await call("GET", "/audit-logs", { token: ctx.accountant })).status, 403);
    });

    await t.test("zones, locations, routes and passenger-tier rates are managed by the admin", async () => {
      const zoneA = await call("POST", "/zones", { token: ctx.admin, body: { code: "a", name: "Zone A" } });
      assert.equal(zoneA.status, 201);
      assert.equal(zoneA.data.code, "A");
      const zoneB = await call("POST", "/zones", { token: ctx.admin, body: { code: "B", name: "Zone B" } });
      const zoneC = await call("POST", "/zones", { token: ctx.admin, body: { code: "C", name: "Zone C" } });
      assert.equal((await call("POST", "/zones", { token: ctx.admin, body: { code: "A", name: "Duplicate" } })).status, 409);
      ctx.zones = { A: zoneA.data.id, B: zoneB.data.id, C: zoneC.data.id };

      const airport = await call("POST", "/locations", { token: ctx.admin, body: { name: "Airport", type: "AIRPORT", zoneId: ctx.zones.A } });
      const hotel = await call("POST", "/locations", { token: ctx.admin, body: { name: "Beach Hotel", type: "HOTEL", zoneId: ctx.zones.B, address: "North coast" } });
      const villa = await call("POST", "/locations", { token: ctx.admin, body: { name: "Villa", type: "AREA", zoneId: ctx.zones.C } });
      assert.equal(airport.status, 201);
      assert.equal(hotel.data.zone.code, "B");
      ctx.locations = { airport: airport.data.id, hotel: hotel.data.id, villa: villa.data.id };
      const badZone = await call("POST", "/locations", { token: ctx.admin, body: { name: "Nowhere", type: "AREA", zoneId: "507f1f77bcf86cd799439011" } });
      assert.equal(badZone.code, "TRANSFER_ZONE_NOT_FOUND");

      const route = await call("POST", "/routes", { token: ctx.admin, body: { fromZoneId: ctx.zones.A, toZoneId: ctx.zones.B, bidirectional: true, durationMinutes: 70 } });
      assert.equal(route.status, 201);
      ctx.routeAB = route.data.id;
      const reverse = await call("POST", "/routes", { token: ctx.admin, body: { fromZoneId: ctx.zones.B, toZoneId: ctx.zones.A } });
      assert.equal(reverse.code, "TRANSFER_ROUTE_DIRECTION_CONFLICT");

      const rate = await call("POST", "/rates", { token: ctx.admin, body: { routeId: ctx.routeAB, minPassengers: 1, maxPassengers: 5, price: "45" } });
      assert.equal(rate.status, 201);
      assert.equal(rate.data.price, "45.00");
      assert.equal(rate.data.basis, "PER_VEHICLE");
      ctx.rate = rate.data.id;
      assert.equal((await call("POST", "/rates", { token: ctx.admin, body: { routeId: ctx.routeAB, minPassengers: 4, maxPassengers: 8, price: "70" } })).code, "TRANSFER_RATE_TIER_OVERLAP");
      assert.equal((await call("POST", "/rates", { token: ctx.admin, body: { routeId: ctx.routeAB, minPassengers: 6, maxPassengers: 3, price: "70" } })).code, "TRANSFER_INVALID_TIER");
      assert.equal((await call("POST", "/rates", { token: ctx.admin, body: { routeId: ctx.routeAB, minPassengers: 6, maxPassengers: 8, price: "-5" } })).status, 422);
      assert.equal((await call("POST", "/rates", { token: ctx.admin, body: { routeId: ctx.routeAB, minPassengers: 6, maxPassengers: 8, price: "70.123" } })).status, 422);
      assert.equal((await call("POST", "/rates", { token: ctx.admin, body: { routeId: ctx.routeAB, minPassengers: 6, maxPassengers: 8, price: "70", currency: "EUR" } })).status, 422);
    });

    await t.test("the server prices quotes from the database and ignores any client price", async () => {
      const preview = (body, token = ctx.admin) => call("POST", "/pricing/preview", { token, body });
      const oneWay = await preview({ pickupLocationId: ctx.locations.airport, dropoffLocationId: ctx.locations.hotel, passengers: { adults: 3 } });
      assert.equal(oneWay.status, 200);
      assert.equal(oneWay.data.status, "PRICED");
      assert.equal(oneWay.data.total, "45.00");

      const roundTrip = await preview({ tripType: "ROUND_TRIP", pickupLocationId: ctx.locations.airport, dropoffLocationId: ctx.locations.hotel, passengers: { adults: 2, children: 1 } });
      assert.equal(roundTrip.data.total, "90.00");
      assert.deepEqual(roundTrip.data.legs.map((leg) => `${leg.fromZone.code}->${leg.toZone.code}`), ["A->B", "B->A"]);

      const six = await preview({ pickupLocationId: ctx.locations.airport, dropoffLocationId: ctx.locations.hotel, passengers: { adults: 6 } });
      assert.equal(six.data.status, "QUOTE_REQUIRED");
      const noRoute = await preview({ pickupLocationId: ctx.locations.airport, dropoffLocationId: ctx.locations.villa, passengers: { adults: 1 } });
      assert.deepEqual(noRoute.data.reasons, ["NO_ROUTE"]);

      const injected = await preview({ pickupLocationId: ctx.locations.airport, dropoffLocationId: ctx.locations.hotel, passengers: { adults: 1 }, price: "1" });
      assert.equal(injected.status, 422);
      assert.equal((await preview({ pickupLocationId: ctx.locations.airport, dropoffLocationId: ctx.locations.hotel, passengers: { adults: 1 } }, ctx.dispatcher)).status, 403);
    });

    await t.test("infant pricing is configurable while infants always count for capacity", async () => {
      const body = { pickupLocationId: ctx.locations.airport, dropoffLocationId: ctx.locations.hotel, passengers: { adults: 5, infants: 1 } };
      const excluded = await call("POST", "/pricing/preview", { token: ctx.admin, body });
      assert.equal(excluded.data.total, "45.00");
      assert.equal(excluded.data.passengers.capacity, 6);
      assert.equal((await call("PATCH", "/settings/pricing", { token: ctx.manager, body: { infantPricing: "COUNTED" } })).status, 403);
      const updated = await call("PATCH", "/settings/pricing", { token: ctx.admin, body: { infantPricing: "COUNTED", reason: "policy test" } });
      assert.equal(updated.data.infantPricing, "COUNTED");
      const counted = await call("POST", "/pricing/preview", { token: ctx.admin, body });
      assert.equal(counted.data.status, "QUOTE_REQUIRED");
      await call("PATCH", "/settings/pricing", { token: ctx.admin, body: { infantPricing: "EXCLUDED" } });
    });

    await t.test("rate changes and deactivations take effect immediately", async () => {
      const body = { pickupLocationId: ctx.locations.airport, dropoffLocationId: ctx.locations.hotel, passengers: { adults: 2 } };
      await call("PATCH", `/rates/${ctx.rate}`, { token: ctx.admin, body: { price: "50", reason: "season" } });
      assert.equal((await call("POST", "/pricing/preview", { token: ctx.admin, body })).data.total, "50.00");
      await call("PATCH", `/routes/${ctx.routeAB}`, { token: ctx.admin, body: { active: false } });
      assert.equal((await call("POST", "/pricing/preview", { token: ctx.admin, body })).data.status, "QUOTE_REQUIRED");
      await call("PATCH", `/routes/${ctx.routeAB}`, { token: ctx.admin, body: { active: true } });
      await call("PATCH", `/zones/${ctx.zones.B}`, { token: ctx.admin, body: { active: false } });
      assert.equal((await call("POST", "/pricing/preview", { token: ctx.admin, body })).code, "TRANSFER_ZONE_UNAVAILABLE");
      await call("PATCH", `/zones/${ctx.zones.B}`, { token: ctx.admin, body: { active: true } });
    });

    await t.test("an admin deletes an unused zone with its locations, routes and rates; a zone used by bookings is kept", async () => {
      const zone = (await call("POST", "/zones", { token: ctx.admin, body: { code: "DEL", name: "To delete" } })).data;
      const location = (await call("POST", "/locations", { token: ctx.admin, body: { name: "Old hotel", type: "HOTEL", zoneId: zone.id } })).data;
      const route = (await call("POST", "/routes", { token: ctx.admin, body: { fromZoneId: ctx.zones.A, toZoneId: zone.id } })).data;
      await call("POST", "/rates", { token: ctx.admin, body: { routeId: route.id, minPassengers: 1, maxPassengers: 4, price: "30" } });

      assert.equal((await call("DELETE", `/zones/${zone.id}`, { token: ctx.manager, body: { confirmCode: "DEL" } })).status, 403);
      assert.equal((await call("DELETE", `/zones/${zone.id}`, { token: ctx.admin, body: {} })).status, 422);
      assert.equal((await call("DELETE", `/zones/${zone.id}`, { token: ctx.admin, body: { confirmCode: "A" } })).code, "TRANSFER_ZONE_DELETE_UNCONFIRMED");

      // A booking at one of its locations keeps the zone.
      const booking = await store.models.Booking.collection.insertOne({ pickupLocationId: new mongoose.Types.ObjectId(location.id), dropoffLocationId: new mongoose.Types.ObjectId() });
      const inUse = await call("DELETE", `/zones/${zone.id}`, { token: ctx.admin, body: { confirmCode: "del" } });
      assert.equal(inUse.status, 409);
      assert.equal(inUse.code, "TRANSFER_ZONE_IN_USE");
      assert.ok(await store.models.Zone.findById(zone.id));
      await store.models.Booking.collection.deleteOne({ _id: booking.insertedId });

      const deleted = await call("DELETE", `/zones/${zone.id}`, { token: ctx.admin, body: { confirmCode: "del", reason: "imported by mistake" } });
      assert.equal(deleted.status, 200);
      assert.equal(deleted.data.deleted, true);
      assert.equal(await store.models.Zone.countDocuments({ _id: zone.id }), 0);
      assert.equal(await store.models.Location.countDocuments({ zoneId: zone.id }), 0);
      assert.equal(await store.models.Route.countDocuments({ _id: route.id }), 0);
      assert.equal(await store.models.Rate.countDocuments({ routeId: route.id }), 0);
      assert.ok(await store.models.Zone.findById(ctx.zones.A), "other zones stay");
      assert.equal((await call("DELETE", `/zones/${zone.id}`, { token: ctx.admin, body: { confirmCode: "DEL" } })).status, 404);

      const log = (await call("GET", "/audit-logs?action=zone.deleted", { token: ctx.admin })).data.items[0];
      assert.equal(log.before.code, "DEL");
      assert.deepEqual(log.after.removed, { locations: 1, routes: 1, rates: 1 });
      assert.equal(log.reason, "imported by mistake");
    });

    await t.test("every change is in the audit log, with before/after and no secrets, and the log cannot be edited", async () => {
      const logs = await call("GET", "/audit-logs?limit=100", { token: ctx.admin });
      assert.equal(logs.status, 200);
      const actions = logs.data.items.map((item) => item.action);
      for (const action of ["user.created", "auth.login_succeeded", "zone.created", "zone.updated", "location.created", "route.created", "rate.created", "rate.updated", "settings.updated"]) {
        assert.ok(actions.includes(action), action);
      }
      const rateUpdate = logs.data.items.find((item) => item.action === "rate.updated");
      assert.equal(rateUpdate.before.price, "45");
      assert.equal(rateUpdate.after.price, "50");
      assert.equal(rateUpdate.reason, "season");
      assert.equal(rateUpdate.actorEmail, "admin@example.test");
      assert.equal(JSON.stringify(logs.data.items).includes("passwordHash"), false);
      assert.equal(JSON.stringify(logs.data.items).includes("$2a$"), false);
      await assert.rejects(() => store.models.AuditLog.updateOne({}, { $set: { action: "tampered" } }), (error) => error.code === "TRANSFER_AUDIT_IMMUTABLE");
      await assert.rejects(() => store.models.AuditLog.deleteMany({}), (error) => error.code === "TRANSFER_AUDIT_IMMUTABLE");
    });

    await t.test("five wrong passwords lock the account; an admin can unlock it", async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await login("dispatcher@example.test", "Wrong-Passw0rd-123")).status, 401);
      const lockedOut = await login("dispatcher@example.test", PASSWORDS.dispatcher);
      assert.equal(lockedOut.status, 401);
      assert.equal(lockedOut.code, "TRANSFER_INVALID_CREDENTIALS");
      assert.equal((await login("nobody@example.test", "Wrong-Passw0rd-123")).code, "TRANSFER_INVALID_CREDENTIALS");
      const actions = (await call("GET", "/audit-logs?action=auth.account_locked", { token: ctx.admin })).data.items;
      assert.equal(actions.length, 1);
      await call("PATCH", `/users/${ctx.dispatcherId}`, { token: ctx.admin, body: { unlock: true, reason: "verified by phone" } });
      assert.equal((await login("dispatcher@example.test", PASSWORDS.dispatcher)).status, 200);
    });

    await t.test("changing a user's access or password ends their existing sessions", async () => {
      const before = await call("GET", "/auth/me", { token: ctx.manager });
      assert.equal(before.status, 200);
      await call("PATCH", `/users/${ctx.managerId}`, { token: ctx.admin, body: { role: "dispatcher" } });
      assert.equal((await call("GET", "/auth/me", { token: ctx.manager })).status, 401);

      const changed = await call("POST", "/auth/change-password", { token: ctx.accountant, body: { currentPassword: PASSWORDS.accountant, newPassword: "Account-Transfer-Passw0rd-2" } });
      assert.equal(changed.status, 200);
      assert.equal((await call("GET", "/auth/me", { token: ctx.accountant })).status, 401);
      assert.equal((await call("GET", "/auth/me", { token: changed.data.token })).status, 200);

      await call("PATCH", `/users/${ctx.accountantId}`, { token: ctx.admin, body: { isActive: false } });
      assert.equal((await call("GET", "/auth/me", { token: changed.data.token })).status, 401);
      assert.equal((await login("accountant@example.test", "Account-Transfer-Passw0rd-2")).status, 401);
    });

    await t.test("the last active admin cannot be removed and admins cannot demote themselves", async () => {
      const adminId = (await call("GET", "/auth/me", { token: ctx.admin })).data.id;
      assert.equal((await call("PATCH", `/users/${adminId}`, { token: ctx.admin, body: { role: "dispatcher" } })).code, "TRANSFER_SELF_CHANGE");
      assert.equal((await call("PATCH", `/users/${adminId}`, { token: ctx.admin, body: { isActive: false } })).code, "TRANSFER_SELF_CHANGE");
      const second = await call("POST", "/users", { token: ctx.admin, body: { name: "Second admin", email: "admin2@example.test", role: "transfer_admin", password: PASSWORDS.admin } });
      const secondToken = (await login("admin2@example.test", PASSWORDS.admin)).data.token;
      assert.equal((await call("PATCH", `/users/${adminId}`, { token: secondToken, body: { isActive: false } })).status, 200);
      assert.equal((await call("PATCH", `/users/${second.data.id}`, { token: secondToken, body: { isActive: false } })).code, "TRANSFER_SELF_CHANGE");
      await store.models.AdminUser.updateOne({ _id: adminId }, { $set: { isActive: true } });
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    const store = await getTransferStore().catch(() => null);
    if (store) await store.connection.db.dropDatabase();
    await closeTransferStore();
  }
});
