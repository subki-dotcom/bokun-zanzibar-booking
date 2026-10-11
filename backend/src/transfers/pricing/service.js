const mongoose = require("mongoose");
const AppError = require("../../utils/AppError");
const { computeQuote } = require("./engine");

const validId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

// Loads what a quote needs from the Transfer System database and prices it with the shared engine.
// Prices always come from the database: callers never supply an amount.
const createPricingService = ({ getStore }) => {
  const quote = async ({ tripType, pickupLocationId, dropoffLocationId, passengers }, { session = null } = {}) => {
    if (!validId(pickupLocationId) || !validId(dropoffLocationId)) {
      throw new AppError("Choose a pickup and a drop-off location", 422, "TRANSFER_LOCATION_REQUIRED");
    }
    const { models } = await getStore();
    const scoped = (query) => (session ? query.session(session) : query);
    const locations = await scoped(models.Location.find({ _id: { $in: [pickupLocationId, dropoffLocationId] } }).lean());
    const zones = await scoped(models.Zone.find({ _id: { $in: locations.map((location) => location.zoneId) } }).lean());
    const zoneById = new Map(zones.map((zone) => [String(zone._id), zone]));
    const withZone = (locationId) => {
      const location = locations.find((item) => String(item._id) === String(locationId));
      return location ? { ...location, zone: zoneById.get(String(location.zoneId)) || null } : null;
    };
    const zoneIds = zones.map((zone) => zone._id);
    const routes = await scoped(models.Route.find({ active: true, fromZoneId: { $in: zoneIds }, toZoneId: { $in: zoneIds } }).lean());
    const rates = routes.length ? await scoped(models.Rate.find({ active: true, routeId: { $in: routes.map((route) => route._id) } }).lean()) : [];
    const settings = (await scoped(models.Settings.findOne({ key: "pricing" }).lean())) || {};

    return computeQuote({ tripType, pickup: withZone(pickupLocationId), dropoff: withZone(dropoffLocationId), passengers, settings, routes, rates });
  };

  return { quote };
};

module.exports = { createPricingService };
