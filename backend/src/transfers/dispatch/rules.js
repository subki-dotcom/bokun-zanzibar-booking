const { TRIP_STATUS, BOOKING_STATUS } = require("../models");

const S = TRIP_STATUS;

// Allowed trip status changes. COMPLETED and NO_SHOW are final. A no-show can only be declared once the driver
// is at the pickup point.
const TRIP_TRANSITIONS = Object.freeze({
  [S.SCHEDULED]: [S.DRIVER_EN_ROUTE],
  [S.DRIVER_EN_ROUTE]: [S.ARRIVED_AT_PICKUP],
  [S.ARRIVED_AT_PICKUP]: [S.IN_PROGRESS, S.NO_SHOW],
  [S.IN_PROGRESS]: [S.COMPLETED],
  [S.COMPLETED]: [],
  [S.NO_SHOW]: []
});

const FINAL_TRIP_STATUSES = Object.freeze([S.COMPLETED, S.NO_SHOW]);
// A driver or vehicle can still be changed until the driver reaches the pickup point.
const REASSIGNABLE_STATUSES = Object.freeze([S.SCHEDULED, S.DRIVER_EN_ROUTE]);

const nextTripStatuses = (status) => TRIP_TRANSITIONS[status] || [];
const canTransition = (from, to) => nextTripStatuses(from).includes(to);

// Only confirmed bookings are dispatched. A booking is confirmed by a verified payment or by an approved
// cash-on-arrival arrangement; quote requests, unpaid bookings and rejected bookings are not.
const dispatchBlockers = (booking) => {
  if (!booking) return ["BOOKING_NOT_FOUND"];
  if (booking.status === BOOKING_STATUS.CONFIRMED) return [];
  return [`BOOKING_${booking.status}`];
};

const todayIn = (offsetMinutes, at) => new Date(at.getTime() + offsetMinutes * 60000).toISOString().slice(0, 10);

const driverBlockers = (driver, { pickupAt } = {}) => {
  if (!driver) return ["DRIVER_NOT_FOUND"];
  const blockers = [];
  if (driver.active === false) blockers.push("DRIVER_INACTIVE");
  if (driver.availability && driver.availability !== "AVAILABLE") blockers.push(`DRIVER_${driver.availability}`);
  // A licence that expires before the trip date makes the driver unassignable for that trip (dates in Zanzibar time).
  if (driver.licenseExpiresOn && pickupAt && driver.licenseExpiresOn < todayIn(180, pickupAt)) blockers.push("DRIVER_LICENSE_EXPIRED");
  return blockers;
};

// Capacity counts every passenger, infants included, because every passenger needs a seat.
const vehicleBlockers = (vehicle, { seatsNeeded = 0 } = {}) => {
  if (!vehicle) return ["VEHICLE_NOT_FOUND"];
  const blockers = [];
  if (vehicle.active === false) blockers.push("VEHICLE_INACTIVE");
  if (vehicle.operationalStatus && vehicle.operationalStatus !== "AVAILABLE") blockers.push(`VEHICLE_${vehicle.operationalStatus}`);
  if (Number(vehicle.passengerCapacity) < Number(seatsNeeded)) blockers.push("VEHICLE_TOO_SMALL");
  return blockers;
};

// Two trips clash when their time windows, widened by the buffer on each side, overlap.
const windowsOverlap = (left, right, bufferMinutes = 0) => {
  const buffer = bufferMinutes * 60000;
  return new Date(left.pickupAt).getTime() < new Date(right.endAt).getTime() + buffer && new Date(right.pickupAt).getTime() < new Date(left.endAt).getTime() + buffer;
};

const tripEnd = (pickupAt, durationMinutes) => new Date(new Date(pickupAt).getTime() + durationMinutes * 60000);

const BLOCKER_MESSAGES = Object.freeze({
  BOOKING_QUOTE_REQUESTED: "the booking is still a quote request",
  BOOKING_AWAITING_PAYMENT: "the booking is awaiting payment or approval",
  BOOKING_REJECTED: "the booking was rejected",
  BOOKING_CANCELLED: "the booking was cancelled",
  DRIVER_INACTIVE: "the driver is deactivated",
  DRIVER_OFF_DUTY: "the driver is off duty",
  DRIVER_ON_LEAVE: "the driver is on leave",
  DRIVER_LICENSE_EXPIRED: "the driver's licence expires before this trip",
  VEHICLE_INACTIVE: "the vehicle is deactivated",
  VEHICLE_MAINTENANCE: "the vehicle is in maintenance",
  VEHICLE_OUT_OF_SERVICE: "the vehicle is out of service",
  VEHICLE_TOO_SMALL: "the vehicle has too few seats for the passengers (infants included)"
});

const describeBlockers = (blockers) => blockers.map((code) => BLOCKER_MESSAGES[code] || code.toLowerCase().replace(/_/g, " "));

module.exports = {
  TRIP_TRANSITIONS,
  FINAL_TRIP_STATUSES,
  REASSIGNABLE_STATUSES,
  nextTripStatuses,
  canTransition,
  dispatchBlockers,
  driverBlockers,
  vehicleBlockers,
  windowsOverlap,
  tripEnd,
  describeBlockers
};
