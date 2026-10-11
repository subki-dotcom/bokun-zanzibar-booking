const mongoose = require("mongoose");
const AppError = require("../../utils/AppError");
const { withTransaction } = require("../db/connection");
const { recordTransferAudit } = require("./audit");

const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const validId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const activeFilter = (value) => (value === "true" ? true : value === "false" ? false : undefined);

const driverToApi = (driver) =>
  driver && {
    id: String(driver._id),
    fullName: driver.fullName,
    phone: driver.phone,
    whatsapp: Boolean(driver.whatsapp),
    licenseNumber: driver.licenseNumber,
    licenseClass: driver.licenseClass || "",
    licenseExpiresOn: driver.licenseExpiresOn || "",
    availability: driver.availability,
    notes: driver.notes || "",
    active: driver.active !== false,
    createdAt: driver.createdAt,
    updatedAt: driver.updatedAt
  };

const vehicleToApi = (vehicle) =>
  vehicle && {
    id: String(vehicle._id),
    registrationNumber: vehicle.registrationNumber,
    makeModel: vehicle.makeModel || "",
    vehicleType: vehicle.vehicleType,
    passengerCapacity: vehicle.passengerCapacity,
    luggageCapacity: vehicle.luggageCapacity ?? null,
    ownership: vehicle.ownership,
    partnerName: vehicle.partnerName || "",
    operationalStatus: vehicle.operationalStatus,
    notes: vehicle.notes || "",
    active: vehicle.active !== false,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt
  };

const DRIVER_FIELDS = ["fullName", "phone", "whatsapp", "licenseNumber", "licenseClass", "licenseExpiresOn", "availability", "notes", "active"];
const VEHICLE_FIELDS = ["registrationNumber", "makeModel", "vehicleType", "passengerCapacity", "luggageCapacity", "ownership", "partnerName", "operationalStatus", "notes", "active"];

// A partner vehicle needs the partner's name; a company vehicle has none.
const checkOwnership = (vehicle) => {
  if (vehicle.ownership === "PARTNER" && !String(vehicle.partnerName || "").trim()) {
    throw new AppError("Give the partner's name for a partner vehicle.", 422, "TRANSFER_PARTNER_NAME_REQUIRED");
  }
  if (vehicle.ownership === "COMPANY") vehicle.partnerName = "";
};

const createTransferFleetService = ({ getStore }) => {
  const audited = async ({ actor, context, action, entityType, run }) => {
    const store = await getStore();
    return withTransaction(store, async (session) => {
      const { record, before = null, reason = "" } = await run(store.models, session);
      await recordTransferAudit(store.models, { actor, action, entityType, entityId: record._id, before, after: record, reason, context }, session);
      return record;
    });
  };

  const assignmentHistory = async ({ field, id }) => {
    if (!validId(id)) throw new AppError("Not found", 404, "TRANSFER_NOT_FOUND");
    const { models } = await getStore();
    const trips = await models.Trip.find({ [`assignmentHistory.${field}`]: id }).sort({ pickupAt: -1 }).limit(100).lean();
    return trips.map((trip) => ({
      tripId: String(trip._id),
      bookingId: String(trip.bookingId),
      bookingReference: trip.bookingReference,
      direction: trip.direction,
      pickupAt: trip.pickupAt,
      status: trip.status,
      current: String(trip[field] || "") === String(id),
      history: trip.assignmentHistory.filter((entry) => String(entry[field] || "") === String(id)).map((entry) => ({ action: entry.action, at: entry.at, by: entry.by, reason: entry.reason || "" }))
    }));
  };

  // ---------- Drivers ----------
  const listDrivers = async ({ query = {} } = {}) => {
    const { models } = await getStore();
    const filter = {};
    const active = activeFilter(query.active);
    if (active !== undefined) filter.active = active;
    if (["AVAILABLE", "OFF_DUTY", "ON_LEAVE"].includes(query.availability)) filter.availability = query.availability;
    if (query.search) {
      const pattern = new RegExp(escapeRegex(String(query.search).slice(0, 100)), "i");
      filter.$or = [{ fullName: pattern }, { phone: pattern }, { licenseNumber: pattern }];
    }
    return (await models.Driver.find(filter).sort({ active: -1, fullName: 1 }).lean()).map(driverToApi);
  };

  const createDriver = async ({ actor, context, input }) =>
    driverToApi(
      (
        await audited({
          actor, context, action: "driver.created", entityType: "TransferDriver",
          run: async (models, session) => {
            const [record] = await models.Driver.create([Object.fromEntries(DRIVER_FIELDS.filter((field) => input[field] !== undefined).map((field) => [field, input[field]]))], session ? { session } : {});
            return { record };
          }
        })
      ).toObject()
    );

  const updateDriver = async ({ actor, context, driverId, input }) => {
    if (!validId(driverId)) throw new AppError("Driver not found", 404, "TRANSFER_NOT_FOUND");
    return driverToApi(
      (
        await audited({
          actor, context, action: "driver.updated", entityType: "TransferDriver",
          run: async (models, session) => {
            const record = await models.Driver.findById(driverId).session(session);
            if (!record) throw new AppError("Driver not found", 404, "TRANSFER_NOT_FOUND");
            const before = record.toObject();
            DRIVER_FIELDS.forEach((field) => {
              if (input[field] !== undefined) record[field] = input[field];
            });
            await record.save({ session });
            return { record, before, reason: input.reason || "" };
          }
        })
      ).toObject()
    );
  };

  // ---------- Vehicles ----------
  const listVehicles = async ({ query = {} } = {}) => {
    const { models } = await getStore();
    const filter = {};
    const active = activeFilter(query.active);
    if (active !== undefined) filter.active = active;
    if (["AVAILABLE", "MAINTENANCE", "OUT_OF_SERVICE"].includes(query.operationalStatus)) filter.operationalStatus = query.operationalStatus;
    if (Number(query.minSeats) > 0) filter.passengerCapacity = { $gte: Number(query.minSeats) };
    if (query.search) {
      const pattern = new RegExp(escapeRegex(String(query.search).slice(0, 100)), "i");
      filter.$or = [{ registrationNumber: pattern }, { makeModel: pattern }, { partnerName: pattern }];
    }
    return (await models.Vehicle.find(filter).sort({ active: -1, registrationNumber: 1 }).lean()).map(vehicleToApi);
  };

  const createVehicle = async ({ actor, context, input }) =>
    vehicleToApi(
      (
        await audited({
          actor, context, action: "vehicle.created", entityType: "TransferVehicle",
          run: async (models, session) => {
            const data = Object.fromEntries(VEHICLE_FIELDS.filter((field) => input[field] !== undefined).map((field) => [field, input[field]]));
            checkOwnership(data);
            const [record] = await models.Vehicle.create([data], session ? { session } : {});
            return { record };
          }
        })
      ).toObject()
    );

  const updateVehicle = async ({ actor, context, vehicleId, input }) => {
    if (!validId(vehicleId)) throw new AppError("Vehicle not found", 404, "TRANSFER_NOT_FOUND");
    return vehicleToApi(
      (
        await audited({
          actor, context, action: "vehicle.updated", entityType: "TransferVehicle",
          run: async (models, session) => {
            const record = await models.Vehicle.findById(vehicleId).session(session);
            if (!record) throw new AppError("Vehicle not found", 404, "TRANSFER_NOT_FOUND");
            const before = record.toObject();
            VEHICLE_FIELDS.forEach((field) => {
              if (input[field] !== undefined) record[field] = input[field];
            });
            checkOwnership(record);
            await record.save({ session });
            return { record, before, reason: input.reason || "" };
          }
        })
      ).toObject()
    );
  };

  return {
    listDrivers,
    createDriver,
    updateDriver,
    driverHistory: ({ driverId }) => assignmentHistory({ field: "driverId", id: driverId }),
    listVehicles,
    createVehicle,
    updateVehicle,
    vehicleHistory: ({ vehicleId }) => assignmentHistory({ field: "vehicleId", id: vehicleId })
  };
};

module.exports = { createTransferFleetService, driverToApi, vehicleToApi };
