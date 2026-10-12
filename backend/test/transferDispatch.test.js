// Fleet and dispatch end to end against a real MongoDB, using a throwaway database dropped afterwards.
// Skipped when no MongoDB is reachable on 127.0.0.1:27017 (for example in CI).
const TEST_DB = `rt_dispatch_${process.pid}`;
process.env.NODE_ENV = "test";
process.env.MONGO_URI = `mongodb://127.0.0.1:27017/business_platform_test_${process.pid}`;
process.env.JWT_SECRET = "business-platform-test-secret-0123456789";
process.env.TRANSFERS_MONGO_URI = "mongodb://127.0.0.1:27017";
process.env.TRANSFERS_DB_NAME = TEST_DB;
process.env.TRANSFER_JWT_SECRET = "transfer-admin-test-secret-0123456789abcdef";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const mongoose = require("mongoose");

const app = require("../src/app");
const { getTransferStore, closeTransferStore } = require("../src/transfers/db/connection");
const { createTransferServices } = require("../src/transfers");

const PASSWORD = "Dispatch-Test-Passw0rd";

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

const daysAhead = (days) => new Date(Date.now() + days * 86400000 + 3 * 3600000).toISOString().slice(0, 10);

test("fleet and dispatch against a real database", async (t) => {
  if (!(await mongoReachable())) {
    t.skip("MongoDB is not reachable on 127.0.0.1:27017");
    return;
  }
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/transfer-admin`;
  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, json, data: json?.data, code: json?.error?.code };
  };
  const login = async (email) => (await call("POST", "/auth/login", { body: { email, password: PASSWORD } })).data.token;

  try {
    const store = await getTransferStore();
    const services = createTransferServices();
    await services.auth.createFirstAdmin({ name: "Admin", email: "admin@example.test", password: PASSWORD });
    const admin = await login("admin@example.test");
    for (const [email, role] of [["manager@example.test", "transfer_manager"], ["dispatcher@example.test", "dispatcher"], ["accountant@example.test", "transfer_accountant"]]) {
      await call("POST", "/users", { token: admin, body: { name: role, email, role, password: PASSWORD } });
    }
    const manager = await login("manager@example.test");
    const dispatcher = await login("dispatcher@example.test");
    const accountant = await login("accountant@example.test");

    const actor = { id: "", email: "setup", role: "transfer_admin" };
    const zoneA = await services.catalog.createZone({ actor, input: { code: "A", name: "Zone A" } });
    const zoneB = await services.catalog.createZone({ actor, input: { code: "B", name: "Zone B" } });
    const airport = await services.catalog.createLocation({ actor, input: { name: "Airport", type: "AIRPORT", zoneId: zoneA.id } });
    const hotel = await services.catalog.createLocation({ actor, input: { name: "Hotel", type: "HOTEL", zoneId: zoneB.id } });
    const route = await services.catalog.createRoute({ actor, input: { fromZoneId: zoneA.id, toZoneId: zoneB.id, bidirectional: true, durationMinutes: 60 } });
    await services.catalog.createRate({ actor, input: { routeId: route.id, minPassengers: 1, maxPassengers: 8, price: "45" } });
    await services.catalog.updateSettings({ actor, input: { assignmentBufferMinutes: 30 } });

    const date = daysAhead(6);
    // Bookings are made on the website. A paid booking stands in for one the payment phase has confirmed after a
    // verified online payment (written directly to this throwaway database, as the payment code will).
    const booking = async ({ name, time, adults = 2, infants = 0, tripType = "ONE_WAY", paid = true }) => {
      const body = {
        tripType, pickupLocationId: airport.id, dropoffLocationId: hotel.id, travelDate: date, travelTime: time,
        ...(tripType === "ROUND_TRIP" ? { returnDate: daysAhead(9), returnTime: "10:00" } : {}),
        passengers: { adults, infants }, customer: { fullName: name, email: `${name.replace(/\s/g, "").toLowerCase()}@example.test`, phone: "+255 700 000 100" },
        expectedTotal: tripType === "ROUND_TRIP" ? "90.00" : "45.00"
      };
      const response = await fetch(`${base.replace("/transfer-admin", "/transfers")}/bookings`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
      const created = (await response.json()).data;
      assert.equal(response.status, 201, JSON.stringify(created));
      const stored = await store.models.Booking.findOne({ reference: created.reference }).lean();
      if (paid) {
        await store.models.Booking.updateOne({ _id: stored._id }, { $set: { status: "CONFIRMED", paymentStatus: "PAID" }, $push: { statusHistory: { status: "CONFIRMED", at: new Date(), by: "payment", note: "Test: verified online payment" } } }, { verifiedPayment: true });
      }
      return { id: String(stored._id), reference: created.reference };
    };
    const tripsOf = async (bookingId, token = manager) => (await call("GET", `/bookings/${bookingId}`, { token })).data.trips;
    const assign = (trip, driverId, vehicleId, extra = {}, token = dispatcher) => call("POST", `/dispatch/trips/${trip.id}/assign`, { token, body: { driverId, vehicleId, expectedVersion: trip.version, ...extra } });
    const status = (trip, next, extra = {}, token = dispatcher) => call("POST", `/dispatch/trips/${trip.id}/status`, { token, body: { status: next, expectedVersion: trip.version, ...extra } });
    const ctx = {};

    await t.test("only managers and admins manage drivers and vehicles; dispatchers can view; accountants cannot", async () => {
      const driver = { fullName: "Juma Driver", phone: "+255 711 111 111", whatsapp: true, licenseNumber: "dl-1001", licenseExpiresOn: daysAhead(400) };
      assert.equal((await call("POST", "/drivers", { token: dispatcher, body: driver })).status, 403);
      const created = await call("POST", "/drivers", { token: manager, body: driver });
      assert.equal(created.status, 201);
      assert.equal(created.data.licenseNumber, "DL-1001");
      ctx.d1 = created.data.id;
      ctx.d2 = (await call("POST", "/drivers", { token: manager, body: { ...driver, fullName: "Asha Driver", licenseNumber: "DL-1002" } })).data.id;
      ctx.dExpired = (await call("POST", "/drivers", { token: manager, body: { ...driver, fullName: "Old Licence", licenseNumber: "DL-1003", licenseExpiresOn: daysAhead(2) } })).data.id;
      assert.equal((await call("POST", "/drivers", { token: manager, body: { ...driver, fullName: "Copy" } })).status, 409, "licence numbers are unique");

      const vehicle = { registrationNumber: "T 123 ABC", vehicleType: "VAN", passengerCapacity: 4, ownership: "COMPANY" };
      ctx.v4 = (await call("POST", "/vehicles", { token: manager, body: vehicle })).data.id;
      ctx.v7 = (await call("POST", "/vehicles", { token: manager, body: { ...vehicle, registrationNumber: "T 456 DEF", vehicleType: "MINIBUS", passengerCapacity: 7, ownership: "PARTNER", partnerName: "Coast Partners" } })).data.id;
      ctx.vShop = (await call("POST", "/vehicles", { token: manager, body: { ...vehicle, registrationNumber: "T 789 GHI", operationalStatus: "MAINTENANCE" } })).data.id;
      assert.equal((await call("POST", "/vehicles", { token: manager, body: { ...vehicle, registrationNumber: "T 999 ZZZ", ownership: "PARTNER" } })).code, "TRANSFER_PARTNER_NAME_REQUIRED");
      assert.equal((await call("POST", "/vehicles", { token: manager, body: { ...vehicle, registrationNumber: "t 123 abc" } })).status, 409, "registrations are unique");

      assert.equal((await call("GET", "/drivers", { token: dispatcher })).data.length, 3);
      assert.equal((await call("GET", "/vehicles?minSeats=5", { token: dispatcher })).data.length, 1);
      assert.equal((await call("GET", "/drivers", { token: accountant })).status, 403);
      assert.equal((await call("GET", "/dispatch/trips", { token: accountant })).status, 403);
      assert.equal(await store.models.AuditLog.countDocuments({ action: { $in: ["driver.created", "vehicle.created"] } }), 6);
    });

    await t.test("a one-way booking has one trip, a round trip has two; unconfirmed bookings cannot be dispatched", async () => {
      ctx.b1 = await booking({ name: "Family One", time: "09:00", adults: 3, infants: 1 });
      ctx.roundTrip = await booking({ name: "Round Unpaid", time: "15:00", tripType: "ROUND_TRIP", paid: false });
      const oneWay = await tripsOf(ctx.b1.id);
      assert.equal(oneWay.length, 1);
      assert.equal(oneWay[0].status, "SCHEDULED");
      assert.equal(oneWay[0].seatsNeeded, 4);
      assert.equal(oneWay[0].dispatchable, true);
      ctx.t1 = oneWay[0];
      const both = await tripsOf(ctx.roundTrip.id);
      assert.deepEqual(both.map((trip) => trip.direction), ["OUTBOUND", "RETURN"]);
      assert.ok(both.every((trip) => !trip.dispatchable && trip.nextStatuses.length === 0));
      assert.equal((await assign(both[0], ctx.d1, ctx.v7)).code, "TRANSFER_TRIP_NOT_DISPATCHABLE");
      assert.equal((await tripsOf(ctx.b1.id, accountant)), undefined, "accountants see bookings without the dispatch details");
    });

    await t.test("drivers and vehicles that are inactive, unavailable, too small or unlicensed are refused", async () => {
      assert.equal((await assign(ctx.t1, ctx.d1, ctx.vShop)).json.error.details.blockers.join(), "VEHICLE_MAINTENANCE");
      assert.equal((await assign(ctx.t1, ctx.dExpired, ctx.v4)).json.error.details.blockers.join(), "DRIVER_LICENSE_EXPIRED");
      await call("PATCH", `/drivers/${ctx.d2}`, { token: manager, body: { availability: "OFF_DUTY", reason: "Day off" } });
      assert.equal((await assign(ctx.t1, ctx.d2, ctx.v4)).json.error.details.blockers.join(), "DRIVER_OFF_DUTY");
      await call("PATCH", `/drivers/${ctx.d2}`, { token: manager, body: { availability: "AVAILABLE", active: false } });
      assert.equal((await assign(ctx.t1, ctx.d2, ctx.v4)).json.error.details.blockers.join(), "DRIVER_INACTIVE");
      await call("PATCH", `/drivers/${ctx.d2}`, { token: manager, body: { active: true } });

      ctx.big = await booking({ name: "Big Group", time: "13:00", adults: 5, infants: 2 });
      const [bigTrip] = await tripsOf(ctx.big.id);
      const tooSmall = await assign(bigTrip, ctx.d2, ctx.v4);
      assert.equal(tooSmall.code, "TRANSFER_ASSIGNMENT_BLOCKED");
      assert.deepEqual(tooSmall.json.error.details.blockers, ["VEHICLE_TOO_SMALL"], "5 adults + 2 infants need 7 seats");
      assert.equal((await assign(bigTrip, ctx.d2, ctx.v7)).status, 200);
    });

    await t.test("a vehicle with exactly enough seats (infants counted) is accepted, and the assignment is audited", async () => {
      const result = await assign(ctx.t1, ctx.d1, ctx.v4);
      assert.equal(result.status, 200);
      assert.equal(result.data.driver.fullName, "Juma Driver");
      assert.equal(result.data.vehicle.registrationNumber, "T 123 ABC");
      assert.equal(result.data.version, 1);
      ctx.t1 = result.data;
      const entry = await store.models.AuditLog.findOne({ action: "trip.assigned", entityId: ctx.t1.id }).lean();
      assert.equal(entry.actorEmail, "dispatcher@example.test");
      assert.equal(entry.after.registrationNumber, "T 123 ABC");
    });

    await t.test("repeated or stale actions are refused instead of being applied twice", async () => {
      const stale = await assign({ ...ctx.t1, version: 0 }, ctx.d2, ctx.v7, { reason: "late click" });
      assert.equal(stale.code, "TRANSFER_TRIP_STALE");
      const first = await status(ctx.t1, "DRIVER_EN_ROUTE");
      const repeat = await status(ctx.t1, "DRIVER_EN_ROUTE");
      assert.equal(first.status, 200);
      assert.equal(repeat.code, "TRANSFER_TRIP_STALE");
      ctx.t1 = first.data;
      const trip = await store.models.Trip.findById(ctx.t1.id).lean();
      assert.equal(trip.statusHistory.filter((entry) => entry.status === "DRIVER_EN_ROUTE").length, 1);
    });

    await t.test("overlapping trips for the same driver or vehicle are refused, including the buffer", async () => {
      // Family One: 09:00–10:00 with a 30-minute buffer, so another trip may start from 10:30.
      const sameTime = await booking({ name: "Same Time", time: "09:30" });
      const insideBuffer = await booking({ name: "Inside Buffer", time: "10:20" });
      const afterBuffer = await booking({ name: "After Buffer", time: "10:45" });
      const [sameTrip] = await tripsOf(sameTime.id);
      const [bufferTrip] = await tripsOf(insideBuffer.id);
      const [laterTrip] = await tripsOf(afterBuffer.id);
      const clash = await assign(sameTrip, ctx.d1, ctx.v7);
      assert.equal(clash.code, "TRANSFER_ASSIGNMENT_CONFLICT");
      assert.match(clash.json.message, /driver already has an overlapping trip/);
      assert.equal((await assign(sameTrip, ctx.d2, ctx.v4)).code, "TRANSFER_ASSIGNMENT_CONFLICT", "the vehicle is busy too");
      assert.equal((await assign(bufferTrip, ctx.d1, ctx.v7)).code, "TRANSFER_ASSIGNMENT_CONFLICT");
      assert.equal((await assign(laterTrip, ctx.d1, ctx.v4)).status, 200);
    });

    await t.test("two dispatchers assigning one driver to overlapping trips at the same moment: only one succeeds", async () => {
      const left = await booking({ name: "Race Left", time: "17:00" });
      const right = await booking({ name: "Race Right", time: "17:15" });
      const [leftTrip] = await tripsOf(left.id);
      const [rightTrip] = await tripsOf(right.id);
      const [one, two] = await Promise.all([assign(leftTrip, ctx.d2, ctx.v7), assign(rightTrip, ctx.d2, ctx.v4, {}, manager)]);
      assert.deepEqual([one.status, two.status].sort(), [200, 409], `${one.code} ${two.code}`);
      const assigned = await store.models.Trip.countDocuments({ driverId: ctx.d2, bookingReference: { $in: [left.reference, right.reference] } });
      assert.equal(assigned, 1);
    });

    await t.test("reassignment needs a reason and stops once the driver has arrived", async () => {
      assert.equal((await assign(ctx.t1, ctx.d2, ctx.v7)).code, "TRANSFER_REASSIGN_REASON_REQUIRED");
      assert.equal((await assign(ctx.t1, ctx.d1, ctx.v4, { reason: "same again" })).code, "TRANSFER_ALREADY_ASSIGNED");
      // d2/v7 are busy at 13:00 (Big Group) but free at 09:00.
      const reassigned = await assign(ctx.t1, ctx.d2, ctx.v7, { reason: "Van has a flat tyre" });
      assert.equal(reassigned.status, 200);
      ctx.t1 = reassigned.data;
      assert.deepEqual(ctx.t1.assignmentHistory.map((entry) => entry.action), ["ASSIGNED", "REASSIGNED"]);
      ctx.t1 = (await status(ctx.t1, "ARRIVED_AT_PICKUP")).data;
      assert.equal((await assign(ctx.t1, ctx.d1, ctx.v4, { reason: "too late" })).code, "TRANSFER_TRIP_NOT_REASSIGNABLE");
    });

    await t.test("the lifecycle is enforced and completing a trip never changes the booking or its payment", async () => {
      assert.equal((await status(ctx.t1, "COMPLETED")).code, "TRANSFER_INVALID_TRIP_TRANSITION");
      ctx.t1 = (await status(ctx.t1, "IN_PROGRESS")).data;
      ctx.t1 = (await status(ctx.t1, "COMPLETED")).data;
      assert.equal(ctx.t1.status, "COMPLETED");
      assert.deepEqual(ctx.t1.nextStatuses, []);
      assert.equal((await status(ctx.t1, "IN_PROGRESS")).code, "TRANSFER_INVALID_TRIP_TRANSITION");
      const stored = await store.models.Booking.findById(ctx.b1.id).lean();
      assert.equal(stored.status, "CONFIRMED");
      assert.equal(stored.paymentStatus, "PAID");
      assert.equal(stored.statusHistory.length, 2, "the trip added nothing to the booking's history");
      const unpaid = await store.models.Booking.findById(ctx.roundTrip.id).lean();
      assert.deepEqual([unpaid.status, unpaid.paymentStatus], ["AWAITING_PAYMENT", "UNPAID"], "an unpaid booking stays unpaid and undispatchable");
    });

    await t.test("a no-show needs a note, and unassigned trips cannot start", async () => {
      const guest = await booking({ name: "No Show", time: "20:00" });
      let [trip] = await tripsOf(guest.id);
      assert.equal((await status(trip, "DRIVER_EN_ROUTE")).code, "TRANSFER_NOT_ASSIGNED");
      trip = (await assign(trip, ctx.d1, ctx.v4)).data;
      trip = (await status(trip, "DRIVER_EN_ROUTE")).data;
      trip = (await status(trip, "ARRIVED_AT_PICKUP")).data;
      assert.equal((await status(trip, "NO_SHOW")).code, "TRANSFER_NO_SHOW_NOTE_REQUIRED");
      const noShow = await status(trip, "NO_SHOW", { note: "Waited 45 minutes, phone off" });
      assert.equal(noShow.data.status, "NO_SHOW");
    });

    await t.test("unassigning needs a reason and is only possible before the trip starts", async () => {
      const later = await booking({ name: "Unassign Me", time: "22:00" });
      let [trip] = await tripsOf(later.id);
      trip = (await assign(trip, ctx.d1, ctx.v7)).data;
      assert.equal((await call("POST", `/dispatch/trips/${trip.id}/unassign`, { token: dispatcher, body: { expectedVersion: trip.version } })).status, 422);
      const done = await call("POST", `/dispatch/trips/${trip.id}/unassign`, { token: dispatcher, body: { expectedVersion: trip.version, reason: "Customer changed plans" } });
      assert.equal(done.status, 200);
      assert.equal(done.data.driver, null);
      assert.equal(done.data.assignmentHistory.at(-1).action, "UNASSIGNED");
    });

    await t.test("driver and vehicle histories list every trip they were assigned to", async () => {
      const history = (await call("GET", `/drivers/${ctx.d1}/history`, { token: dispatcher })).data;
      const familyOne = history.find((item) => item.bookingReference === ctx.b1.reference);
      assert.equal(familyOne.current, false, "reassigned away");
      assert.deepEqual(familyOne.history.map((entry) => entry.action), ["ASSIGNED"]);
      const vehicleHistory = (await call("GET", `/vehicles/${ctx.v7}/history`, { token: dispatcher })).data;
      assert.ok(vehicleHistory.some((item) => item.bookingReference === ctx.b1.reference && item.current));
    });

    await t.test("the schedule lists trips by day and can show only unassigned dispatchable trips", async () => {
      const schedule = await call("GET", `/dispatch/trips?from=${date}&to=${date}`, { token: dispatcher });
      assert.equal(schedule.status, 200);
      const stored = await store.models.Trip.find({ pickupAt: { $gte: new Date(`${date}T00:00:00+03:00`), $lt: new Date(new Date(`${date}T00:00:00+03:00`).getTime() + 86400000) } }).lean();
      assert.equal(schedule.data.items.length, stored.length);
      const unassigned = await call("GET", `/dispatch/trips?from=${date}&to=${date}&unassigned=true`, { token: dispatcher });
      assert.ok(unassigned.data.items.every((trip) => trip.dispatchable && (!trip.driver || !trip.vehicle)));
      const confirmed = new Set((await store.models.Booking.find({ status: "CONFIRMED" }, { _id: 1 }).lean()).map((item) => String(item._id)));
      const expected = stored.filter((item) => confirmed.has(String(item.bookingId)) && (!item.driverId || !item.vehicleId)).map((item) => item.bookingReference).sort();
      assert.ok(expected.length > 0);
      assert.deepEqual(unassigned.data.items.map((trip) => trip.bookingReference).sort(), expected);
      assert.equal((await call("GET", "/dispatch/trips?from=2026-01-01&to=2026-12-31", { token: dispatcher })).code, "TRANSFER_RANGE_TOO_LONG");
    });

    await t.test("the dashboard's dispatch figures come from the trip records", async () => {
      const dashboard = (await call("GET", "/dashboard", { token: manager })).data;
      const confirmedIds = (await store.models.Booking.find({ status: "CONFIRMED" }, { _id: 1 }).lean()).map((item) => item._id);
      const expectedUnassigned = await store.models.Trip.countDocuments({ bookingId: { $in: confirmedIds }, pickupAt: { $gte: new Date() }, status: "SCHEDULED", $or: [{ driverId: null }, { vehicleId: null }] });
      assert.equal(dashboard.dispatch.unassignedCount, expectedUnassigned);
      assert.equal(dashboard.dispatch.completedLast7Days, 1);
      assert.equal(dashboard.dispatch.noShowsLast7Days, 1);
      const paid = await store.models.Booking.find({ paymentStatus: "PAID" }).lean();
      assert.equal(dashboard.paidRevenue.count, paid.length, "revenue is the verified payments only; trips add none");
      assert.equal(dashboard.paidRevenue.amount, (paid.length * 45).toFixed(2));
      assert.equal((await call("GET", "/dashboard", { token: accountant })).data.dispatch, undefined);
    });

    await t.test("every dispatch change is in the audit log", async () => {
      for (const action of ["trip.assigned", "trip.reassigned", "trip.unassigned", "trip.status_changed", "driver.updated"]) {
        assert.ok(await store.models.AuditLog.countDocuments({ action }), action);
      }
      const reassigned = await store.models.AuditLog.findOne({ action: "trip.reassigned" }).lean();
      assert.equal(reassigned.reason, "Van has a flat tyre");
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    const store = await getTransferStore().catch(() => null);
    if (store) await store.connection.db.dropDatabase();
    await closeTransferStore();
  }
});
