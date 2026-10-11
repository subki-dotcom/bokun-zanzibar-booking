const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TRIP_TRANSITIONS,
  canTransition,
  nextTripStatuses,
  dispatchBlockers,
  driverBlockers,
  vehicleBlockers,
  windowsOverlap,
  tripEnd
} = require("../src/transfers/dispatch/rules");

test("trip statuses move forward only, and COMPLETED and NO_SHOW are final", () => {
  const path = ["SCHEDULED", "DRIVER_EN_ROUTE", "ARRIVED_AT_PICKUP", "IN_PROGRESS", "COMPLETED"];
  for (let index = 0; index < path.length - 1; index += 1) assert.ok(canTransition(path[index], path[index + 1]), `${path[index]} → ${path[index + 1]}`);
  assert.ok(canTransition("ARRIVED_AT_PICKUP", "NO_SHOW"));
  for (const [from, to] of [["SCHEDULED", "COMPLETED"], ["SCHEDULED", "NO_SHOW"], ["DRIVER_EN_ROUTE", "SCHEDULED"], ["IN_PROGRESS", "NO_SHOW"], ["COMPLETED", "IN_PROGRESS"], ["NO_SHOW", "SCHEDULED"], ["SCHEDULED", "SCHEDULED"]]) {
    assert.equal(canTransition(from, to), false, `${from} → ${to}`);
  }
  assert.deepEqual(nextTripStatuses("COMPLETED"), []);
  assert.deepEqual(nextTripStatuses("NO_SHOW"), []);
  assert.deepEqual(Object.keys(TRIP_TRANSITIONS).sort(), ["ARRIVED_AT_PICKUP", "COMPLETED", "DRIVER_EN_ROUTE", "IN_PROGRESS", "NO_SHOW", "SCHEDULED"]);
});

test("only confirmed bookings can be dispatched", () => {
  assert.deepEqual(dispatchBlockers({ status: "CONFIRMED", paymentArrangement: "CASH_ON_ARRIVAL", paymentStatus: "UNPAID" }), []);
  for (const status of ["QUOTE_REQUESTED", "AWAITING_PAYMENT", "REJECTED", "CANCELLED"]) assert.deepEqual(dispatchBlockers({ status }), [`BOOKING_${status}`]);
  assert.deepEqual(dispatchBlockers(null), ["BOOKING_NOT_FOUND"]);
});

test("vehicle capacity counts every passenger, infants included", () => {
  const vehicle = { active: true, operationalStatus: "AVAILABLE", passengerCapacity: 4 };
  assert.deepEqual(vehicleBlockers(vehicle, { seatsNeeded: 4 }), []);
  assert.deepEqual(vehicleBlockers(vehicle, { seatsNeeded: 5 }), ["VEHICLE_TOO_SMALL"]);
  assert.deepEqual(vehicleBlockers({ ...vehicle, operationalStatus: "MAINTENANCE" }, { seatsNeeded: 1 }), ["VEHICLE_MAINTENANCE"]);
  assert.deepEqual(vehicleBlockers({ ...vehicle, active: false }, { seatsNeeded: 1 }), ["VEHICLE_INACTIVE"]);
  assert.deepEqual(vehicleBlockers(null), ["VEHICLE_NOT_FOUND"]);
});

test("inactive, unavailable or unlicensed drivers cannot be assigned", () => {
  const pickupAt = new Date("2026-12-10T06:00:00Z");
  const driver = { active: true, availability: "AVAILABLE", licenseExpiresOn: "2027-01-01" };
  assert.deepEqual(driverBlockers(driver, { pickupAt }), []);
  assert.deepEqual(driverBlockers({ ...driver, active: false }, { pickupAt }), ["DRIVER_INACTIVE"]);
  assert.deepEqual(driverBlockers({ ...driver, availability: "ON_LEAVE" }, { pickupAt }), ["DRIVER_ON_LEAVE"]);
  assert.deepEqual(driverBlockers({ ...driver, licenseExpiresOn: "2026-12-09" }, { pickupAt }), ["DRIVER_LICENSE_EXPIRED"]);
  assert.deepEqual(driverBlockers({ ...driver, licenseExpiresOn: "2026-12-10" }, { pickupAt }), [], "a licence valid on the trip day is fine");
  assert.deepEqual(driverBlockers({ ...driver, licenseExpiresOn: "" }, { pickupAt }), []);
});

test("time windows clash when they overlap once the buffer is added", () => {
  const at = (minutes) => new Date(Date.UTC(2026, 11, 10, 6, minutes));
  const trip = (start, duration) => ({ pickupAt: at(start), endAt: tripEnd(at(start), duration) });
  assert.equal(windowsOverlap(trip(0, 60), trip(30, 60)), true);
  assert.equal(windowsOverlap(trip(0, 60), trip(60, 60)), false, "back-to-back trips without a buffer");
  assert.equal(windowsOverlap(trip(0, 60), trip(80, 60), 30), true, "inside the 30-minute buffer");
  assert.equal(windowsOverlap(trip(0, 60), trip(95, 60), 30), false);
  assert.equal(windowsOverlap(trip(95, 60), trip(0, 60), 30), false, "symmetric");
});
