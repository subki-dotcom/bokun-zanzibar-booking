const mongoose = require("mongoose");
const AppError = require("../../utils/AppError");
const { withTransaction } = require("../db/connection");
const { recordTransferAudit } = require("./audit");
const { BOOKING_STATUS, TRIP_STATUS, DEFAULT_TRIP_MINUTES, DEFAULT_BUFFER_MINUTES } = require("../models");
const {
  FINAL_TRIP_STATUSES,
  REASSIGNABLE_STATUSES,
  canTransition,
  nextTripStatuses,
  dispatchBlockers,
  driverBlockers,
  vehicleBlockers,
  tripEnd,
  describeBlockers
} = require("../dispatch/rules");
const { zanzibarDayStart } = require("./adminBookings");

const DAY = 86400000;
const CLOSED_BOOKINGS = [BOOKING_STATUS.REJECTED, BOOKING_STATUS.CANCELLED];
const validId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const notFound = () => new AppError("Trip not found", 404, "TRANSFER_TRIP_NOT_FOUND");
const id = (value) => (value ? String(value) : null);

const dateParam = (value, fallback) => (/^\d{4}-\d{2}-\d{2}$/.test(value || "") ? new Date(`${value}T00:00:00+03:00`) : fallback);

const createTransferDispatchService = ({ getStore, now = () => new Date() }) => {
  const settingsOf = async (models, session = null) => {
    const query = models.Settings.findOne({ key: "pricing" }).lean();
    const settings = (await (session ? query.session(session) : query)) || {};
    return {
      defaultTripMinutes: settings.defaultTripMinutes || DEFAULT_TRIP_MINUTES,
      assignmentBufferMinutes: settings.assignmentBufferMinutes ?? DEFAULT_BUFFER_MINUTES
    };
  };

  // Creates the trips of bookings that do not have them yet (one per leg). Safe to run repeatedly and concurrently.
  const ensureTrips = async (models, bookings) => {
    if (!bookings.length) return;
    const settings = await settingsOf(models);
    const routeIds = [...new Set(bookings.flatMap((booking) => booking.legs.map((leg) => id(leg.routeId)).filter(Boolean)))];
    const routes = routeIds.length ? await models.Route.find({ _id: { $in: routeIds } }, { durationMinutes: 1 }).lean() : [];
    const duration = new Map(routes.map((route) => [String(route._id), route.durationMinutes]));
    const at = now();
    const operations = bookings.flatMap((booking) =>
      booking.legs.map((leg) => ({
        updateOne: {
          filter: { bookingId: booking._id, direction: leg.direction },
          update: {
            $setOnInsert: {
              bookingId: booking._id,
              bookingReference: booking.reference,
              direction: leg.direction,
              pickupAt: leg.pickupAt,
              endAt: tripEnd(leg.pickupAt, duration.get(id(leg.routeId)) || settings.defaultTripMinutes),
              status: TRIP_STATUS.SCHEDULED,
              statusHistory: [{ status: TRIP_STATUS.SCHEDULED, at, by: "system", note: "Trip created from the booking" }],
              assignmentHistory: [],
              version: 0
            }
          },
          upsert: true
        }
      }))
    );
    try {
      await models.Trip.bulkWrite(operations, { ordered: false });
    } catch (error) {
      // Another request created the same trips at the same moment; the unique index keeps one of each.
      if (error?.code !== 11000 && !error?.writeErrors?.every((writeError) => writeError.code === 11000)) throw error;
    }
  };

  const ensureTripsBetween = async (models, from, to) => {
    const bookings = await models.Booking.find({ status: { $nin: CLOSED_BOOKINGS }, legs: { $elemMatch: { pickupAt: { $gte: from, $lt: to } } } }, { reference: 1, legs: 1 }).lean();
    await ensureTrips(models, bookings);
  };

  // Joins trips with their booking, driver and vehicle for display.
  const present = async (models, trips) => {
    const bookingIds = [...new Set(trips.map((trip) => String(trip.bookingId)))];
    const driverIds = [...new Set(trips.map((trip) => id(trip.driverId)).filter(Boolean))];
    const vehicleIds = [...new Set(trips.map((trip) => id(trip.vehicleId)).filter(Boolean))];
    const [bookings, drivers, vehicles] = await Promise.all([
      models.Booking.find({ _id: { $in: bookingIds } }).lean(),
      driverIds.length ? models.Driver.find({ _id: { $in: driverIds } }).lean() : [],
      vehicleIds.length ? models.Vehicle.find({ _id: { $in: vehicleIds } }).lean() : []
    ]);
    const byId = (list) => new Map(list.map((item) => [String(item._id), item]));
    const [bookingMap, driverMap, vehicleMap] = [byId(bookings), byId(drivers), byId(vehicles)];
    return trips.map((trip) => {
      const booking = bookingMap.get(String(trip.bookingId));
      const leg = booking?.legs.find((item) => item.direction === trip.direction);
      const driver = driverMap.get(id(trip.driverId));
      const vehicle = vehicleMap.get(id(trip.vehicleId));
      const blockers = dispatchBlockers(booking);
      return {
        id: String(trip._id),
        version: trip.version,
        bookingId: String(trip.bookingId),
        bookingReference: trip.bookingReference,
        bookingStatus: booking?.status || null,
        paymentStatus: booking?.paymentStatus || null,
        paymentArrangement: booking?.paymentArrangement || null,
        direction: trip.direction,
        tripType: booking?.tripType || null,
        pickupAt: trip.pickupAt,
        endAt: trip.endAt,
        localDate: leg?.localDate || "",
        localTime: leg?.localTime || "",
        pickupLocationName: leg?.pickupLocationName || "",
        dropoffLocationName: leg?.dropoffLocationName || "",
        address: trip.direction === "RETURN" ? booking?.dropoffAddress || "" : booking?.pickupAddress || "",
        flightNumber: booking?.flightNumber || "",
        passengers: booking?.passengers || null,
        seatsNeeded: booking?.passengers?.capacity || 0,
        customer: booking ? { fullName: booking.customer.fullName, phone: booking.customer.phone, whatsapp: Boolean(booking.customer.whatsapp) } : null,
        status: trip.status,
        nextStatuses: blockers.length ? [] : nextTripStatuses(trip.status),
        dispatchable: blockers.length === 0,
        blockers: describeBlockers(blockers),
        driver: driver ? { id: String(driver._id), fullName: driver.fullName, phone: driver.phone } : null,
        vehicle: vehicle ? { id: String(vehicle._id), registrationNumber: vehicle.registrationNumber, vehicleType: vehicle.vehicleType, passengerCapacity: vehicle.passengerCapacity } : null,
        assignedAt: trip.assignedAt,
        assignedBy: trip.assignedBy,
        assignmentHistory: (trip.assignmentHistory || []).map((entry) => ({ ...entry, driverId: id(entry.driverId), vehicleId: id(entry.vehicleId) })),
        statusHistory: trip.statusHistory || []
      };
    });
  };

  const listTrips = async ({ query = {} }) => {
    const { models } = await getStore();
    const start = dateParam(query.from, zanzibarDayStart(now()));
    const end = dateParam(query.to, null) ? new Date(dateParam(query.to).getTime() + DAY) : new Date(start.getTime() + 7 * DAY);
    if (end - start > 62 * DAY) throw new AppError("Choose a range of at most 62 days", 422, "TRANSFER_RANGE_TOO_LONG");
    await ensureTripsBetween(models, start, end);
    const filter = { pickupAt: { $gte: start, $lt: end } };
    if (Object.values(TRIP_STATUS).includes(query.status)) filter.status = query.status;
    if (validId(query.driverId)) filter.driverId = query.driverId;
    if (validId(query.vehicleId)) filter.vehicleId = query.vehicleId;
    if (query.unassigned === "true") filter.$or = [{ driverId: null }, { vehicleId: null }];
    const trips = await models.Trip.find(filter).sort({ pickupAt: 1, _id: 1 }).limit(500).lean();
    const presented = await present(models, trips);
    // Trips of rejected or cancelled bookings are not part of the schedule.
    const visible = presented.filter((trip) => !CLOSED_BOOKINGS.includes(trip.bookingStatus));
    return {
      from: start,
      to: end,
      items: query.unassigned === "true" ? visible.filter((trip) => trip.dispatchable) : visible
    };
  };

  const getTrip = async ({ tripId }) => {
    if (!validId(tripId)) throw notFound();
    const { models } = await getStore();
    const trip = await models.Trip.findById(tripId).lean();
    if (!trip) throw notFound();
    return (await present(models, [trip]))[0];
  };

  const tripsForBooking = async ({ bookingId }) => {
    const { models } = await getStore();
    const booking = await models.Booking.findById(bookingId, { reference: 1, legs: 1, status: 1 }).lean();
    if (!booking) return [];
    if (!CLOSED_BOOKINGS.includes(booking.status)) await ensureTrips(models, [booking]);
    const trips = await models.Trip.find({ bookingId }).sort({ pickupAt: 1 }).lean();
    return present(models, trips);
  };

  // Loads a trip for a change, checking the version the user saw so stale or repeated actions are refused.
  const loadForChange = async (models, tripId, expectedVersion, session) => {
    if (!validId(tripId)) throw notFound();
    const trip = await models.Trip.findById(tripId).session(session).lean();
    if (!trip) throw notFound();
    if (trip.version !== expectedVersion) {
      throw new AppError("This trip was changed by someone else. Refresh and try again.", 409, "TRANSFER_TRIP_STALE", { version: trip.version, status: trip.status });
    }
    const booking = await models.Booking.findById(trip.bookingId).session(session).lean();
    const blockers = dispatchBlockers(booking);
    if (blockers.length) {
      throw new AppError(`This trip cannot be dispatched: ${describeBlockers(blockers).join(", ")}.`, 409, "TRANSFER_TRIP_NOT_DISPATCHABLE", { blockers });
    }
    return { trip, booking };
  };

  const saveChange = async (models, trip, update, session) => {
    const saved = await models.Trip.findOneAndUpdate({ _id: trip._id, version: trip.version }, { ...update, $inc: { version: 1 } }, { new: true, session }).lean();
    if (!saved) throw new AppError("This trip was changed by someone else. Refresh and try again.", 409, "TRANSFER_TRIP_STALE");
    return saved;
  };

  const assign = async ({ actor, tripId, input, context }) => {
    const store = await getStore();
    const { models } = store;
    const saved = await withTransaction(store, async (session) => {
      const { trip, booking } = await loadForChange(models, tripId, input.expectedVersion, session);
      if (!REASSIGNABLE_STATUSES.includes(trip.status)) {
        throw new AppError("The driver and vehicle can no longer be changed for this trip.", 409, "TRANSFER_TRIP_NOT_REASSIGNABLE", { status: trip.status });
      }
      const reassignment = Boolean(trip.driverId || trip.vehicleId);
      const reason = String(input.reason || "").trim();
      if (reassignment && reason.length < 3) throw new AppError("Give a reason for changing the driver or vehicle.", 422, "TRANSFER_REASSIGN_REASON_REQUIRED");
      if (reassignment && id(trip.driverId) === input.driverId && id(trip.vehicleId) === input.vehicleId) {
        throw new AppError("This driver and vehicle are already assigned.", 409, "TRANSFER_ALREADY_ASSIGNED");
      }

      // Lock the driver and vehicle for this transaction: concurrent assignments of either conflict and retry,
      // and the retry sees the other assignment in the overlap check below.
      const [driver, vehicle] = await Promise.all([
        models.Driver.findOneAndUpdate({ _id: input.driverId }, { $inc: { assignmentVersion: 1 } }, { new: true, session }).lean(),
        models.Vehicle.findOneAndUpdate({ _id: input.vehicleId }, { $inc: { assignmentVersion: 1 } }, { new: true, session }).lean()
      ]);
      const blockers = [...driverBlockers(driver, { pickupAt: trip.pickupAt }), ...vehicleBlockers(vehicle, { seatsNeeded: booking.passengers.capacity })];
      if (blockers.length) {
        throw new AppError(`Cannot assign: ${describeBlockers(blockers).join(", ")}.`, 422, "TRANSFER_ASSIGNMENT_BLOCKED", { blockers });
      }

      const { assignmentBufferMinutes } = await settingsOf(models, session);
      const buffer = assignmentBufferMinutes * 60000;
      const clashes = await models.Trip.find({
        _id: { $ne: trip._id },
        status: { $nin: FINAL_TRIP_STATUSES },
        $or: [{ driverId: driver._id }, { vehicleId: vehicle._id }],
        pickupAt: { $lt: new Date(trip.endAt.getTime() + buffer) },
        endAt: { $gt: new Date(trip.pickupAt.getTime() - buffer) }
      }).session(session).lean();
      if (clashes.length) {
        const details = clashes.map((clash) => ({
          tripId: String(clash._id),
          bookingReference: clash.bookingReference,
          pickupAt: clash.pickupAt,
          driver: id(clash.driverId) === String(driver._id),
          vehicle: id(clash.vehicleId) === String(vehicle._id)
        }));
        const what = [details.some((clash) => clash.driver) ? "driver" : "", details.some((clash) => clash.vehicle) ? "vehicle" : ""].filter(Boolean).join(" and ");
        throw new AppError(`The ${what} already has an overlapping trip (${details.map((clash) => clash.bookingReference).join(", ")}).`, 409, "TRANSFER_ASSIGNMENT_CONFLICT", { clashes: details });
      }

      const at = now();
      const result = await saveChange(models, trip, {
        $set: { driverId: driver._id, vehicleId: vehicle._id, assignedAt: at, assignedBy: actor.email },
        $push: { assignmentHistory: { action: reassignment ? "REASSIGNED" : "ASSIGNED", driverId: driver._id, driverName: driver.fullName, vehicleId: vehicle._id, registrationNumber: vehicle.registrationNumber, at, by: actor.email, reason } }
      }, session);
      await recordTransferAudit(models, {
        actor,
        action: reassignment ? "trip.reassigned" : "trip.assigned",
        entityType: "TransferTrip",
        entityId: trip._id,
        before: { driverId: id(trip.driverId), vehicleId: id(trip.vehicleId), version: trip.version },
        after: { driverId: String(driver._id), driverName: driver.fullName, vehicleId: String(vehicle._id), registrationNumber: vehicle.registrationNumber, bookingReference: trip.bookingReference, direction: trip.direction, version: result.version },
        reason,
        context
      }, session);
      return result;
    });
    return (await present(models, [saved]))[0];
  };

  const unassign = async ({ actor, tripId, input, context }) => {
    const store = await getStore();
    const { models } = store;
    const saved = await withTransaction(store, async (session) => {
      const { trip } = await loadForChange(models, tripId, input.expectedVersion, session);
      if (trip.status !== TRIP_STATUS.SCHEDULED) throw new AppError("Only a scheduled trip can be unassigned.", 409, "TRANSFER_TRIP_NOT_REASSIGNABLE", { status: trip.status });
      if (!trip.driverId && !trip.vehicleId) throw new AppError("Nothing is assigned to this trip.", 409, "TRANSFER_NOT_ASSIGNED");
      const at = now();
      const result = await saveChange(models, trip, {
        $set: { driverId: null, vehicleId: null, assignedAt: null, assignedBy: "" },
        $push: { assignmentHistory: { action: "UNASSIGNED", driverId: trip.driverId, vehicleId: trip.vehicleId, at, by: actor.email, reason: input.reason } }
      }, session);
      await recordTransferAudit(models, { actor, action: "trip.unassigned", entityType: "TransferTrip", entityId: trip._id, before: { driverId: id(trip.driverId), vehicleId: id(trip.vehicleId) }, after: { driverId: null, vehicleId: null }, reason: input.reason, context }, session);
      return result;
    });
    return (await present(models, [saved]))[0];
  };

  // Moves a trip along its lifecycle. The booking's status and payment are never touched here.
  const changeStatus = async ({ actor, tripId, input, context }) => {
    const store = await getStore();
    const { models } = store;
    const saved = await withTransaction(store, async (session) => {
      const { trip } = await loadForChange(models, tripId, input.expectedVersion, session);
      if (!canTransition(trip.status, input.status)) {
        throw new AppError(`A trip cannot go from ${trip.status} to ${input.status}.`, 409, "TRANSFER_INVALID_TRIP_TRANSITION", { from: trip.status, to: input.status, allowed: nextTripStatuses(trip.status) });
      }
      if (!trip.driverId || !trip.vehicleId) throw new AppError("Assign a driver and a vehicle first.", 409, "TRANSFER_NOT_ASSIGNED");
      const note = String(input.note || "").trim();
      if (input.status === TRIP_STATUS.NO_SHOW && note.length < 3) throw new AppError("Describe what happened for a no-show.", 422, "TRANSFER_NO_SHOW_NOTE_REQUIRED");
      const at = now();
      const result = await saveChange(models, trip, {
        $set: { status: input.status },
        $push: { statusHistory: { status: input.status, at, by: actor.email, note } }
      }, session);
      await recordTransferAudit(models, { actor, action: "trip.status_changed", entityType: "TransferTrip", entityId: trip._id, before: { status: trip.status }, after: { status: input.status, bookingReference: trip.bookingReference, direction: trip.direction }, reason: note, context }, session);
      return result;
    });
    return (await present(models, [saved]))[0];
  };

  // Operational figures for the dashboard, all from trip records.
  const dashboardSection = async () => {
    const { models } = await getStore();
    const at = now();
    const today = zanzibarDayStart(at);
    const tomorrow = new Date(today.getTime() + DAY);
    const week = new Date(today.getTime() + 8 * DAY);
    await ensureTripsBetween(models, today, week);
    const closedBookingIds = (await models.Booking.find({ status: { $in: CLOSED_BOOKINGS } }, { _id: 1 }).lean()).map((booking) => booking._id);
    const open = { bookingId: { $nin: closedBookingIds } };
    const confirmedIds = (await models.Booking.find({ status: BOOKING_STATUS.CONFIRMED }, { _id: 1 }).lean()).map((booking) => booking._id);
    const [todayTrips, upcomingCount, unassignedCount, completedToday, completedWeek, noShowsWeek, assignments] = await Promise.all([
      models.Trip.find({ ...open, pickupAt: { $gte: today, $lt: tomorrow } }).sort({ pickupAt: 1 }).limit(50).lean(),
      models.Trip.countDocuments({ ...open, pickupAt: { $gte: tomorrow, $lt: week } }),
      models.Trip.countDocuments({ bookingId: { $in: confirmedIds }, pickupAt: { $gte: at }, status: TRIP_STATUS.SCHEDULED, $or: [{ driverId: null }, { vehicleId: null }] }),
      models.Trip.countDocuments({ status: TRIP_STATUS.COMPLETED, statusHistory: { $elemMatch: { status: TRIP_STATUS.COMPLETED, at: { $gte: today } } } }),
      models.Trip.countDocuments({ status: TRIP_STATUS.COMPLETED, statusHistory: { $elemMatch: { status: TRIP_STATUS.COMPLETED, at: { $gte: new Date(today.getTime() - 6 * DAY) } } } }),
      models.Trip.countDocuments({ status: TRIP_STATUS.NO_SHOW, statusHistory: { $elemMatch: { status: TRIP_STATUS.NO_SHOW, at: { $gte: new Date(today.getTime() - 6 * DAY) } } } }),
      models.Trip.aggregate([
        { $match: { ...open, pickupAt: { $gte: today, $lt: tomorrow }, driverId: { $ne: null } } },
        { $group: { _id: "$driverId", trips: { $sum: 1 }, vehicles: { $addToSet: "$vehicleId" } } }
      ])
    ]);
    const drivers = assignments.length ? await models.Driver.find({ _id: { $in: assignments.map((row) => row._id) } }).lean() : [];
    const vehicles = await models.Vehicle.find({ _id: { $in: assignments.flatMap((row) => row.vehicles) } }).lean();
    return {
      today: await present(models, todayTrips),
      upcomingCount,
      unassignedCount,
      completedToday,
      completedLast7Days: completedWeek,
      noShowsLast7Days: noShowsWeek,
      driverAssignmentsToday: assignments
        .map((row) => ({
          driver: drivers.find((driver) => String(driver._id) === String(row._id))?.fullName || "—",
          trips: row.trips,
          vehicles: row.vehicles.map((vehicleId) => vehicles.find((vehicle) => String(vehicle._id) === String(vehicleId))?.registrationNumber).filter(Boolean)
        }))
        .sort((left, right) => right.trips - left.trips)
    };
  };

  return { listTrips, getTrip, tripsForBooking, assign, unassign, changeStatus, dashboardSection, ensureTrips };
};

module.exports = { createTransferDispatchService };
