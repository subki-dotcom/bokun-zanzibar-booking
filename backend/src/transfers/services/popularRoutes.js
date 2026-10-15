const mongoose = require("mongoose");
const AppError = require("../../utils/AppError");
const { moneyString, toDecimal } = require("../../utils/money");
const { withTransaction } = require("../db/connection");
const { recordTransferAudit } = require("./audit");
const { findRoute } = require("../pricing/engine");
const { TRANSFER_CURRENCY } = require("../models");

const id = (value) => (value === null || value === undefined ? null : String(value));
const notFound = () => new AppError("Popular route not found", 404, "TRANSFER_POPULAR_ROUTE_NOT_FOUND");

// The lowest price per vehicle configured for the route between two zones ("From USD 35"), or null when the route
// has no active rate. Same route choice as the pricing engine, so the card and the checkout always agree.
const startingPrice = (routes, rates, fromZoneId, toZoneId) => {
  const route = findRoute(routes, fromZoneId, toZoneId);
  if (!route) return { route: null, from: null };
  const prices = rates.filter((rate) => id(rate.routeId) === id(route._id) && rate.active !== false).map((rate) => toDecimal(rate.price));
  if (!prices.length) return { route, from: null };
  return { route, from: moneyString(prices.reduce((lowest, price) => (price.lessThan(lowest) ? price : lowest))) };
};

const placeView = (location) => ({ id: id(location._id), name: location.name, type: location.type });

const adminView = (product, locationsById) => ({
  id: id(product._id),
  slug: product.slug,
  title: product.title,
  pickupLocationId: id(product.pickupLocationId),
  dropoffLocationId: id(product.dropoffLocationId),
  pickup: locationsById.get(id(product.pickupLocationId)) ? placeView(locationsById.get(id(product.pickupLocationId))) : null,
  dropoff: locationsById.get(id(product.dropoffLocationId)) ? placeView(locationsById.get(id(product.dropoffLocationId))) : null,
  description: product.description || "",
  inclusions: product.inclusions || [],
  displayOrder: product.displayOrder || 0,
  active: product.active !== false,
  updatedAt: product.updatedAt
});

const createPopularRouteService = ({ getStore }) => {
  const loadPlaces = async (models, products) => {
    const ids = products.flatMap((product) => [product.pickupLocationId, product.dropoffLocationId]);
    const locations = await models.Location.find({ _id: { $in: ids } }).lean();
    return new Map(locations.map((location) => [id(location._id), location]));
  };

  // What the website shows: active products whose places and zones are open for booking, in display order, each
  // priced from the configured rates. A product without a rate is offered as "Price on Request".
  const listPublic = async () => {
    const { models } = await getStore();
    const products = await models.PopularRoute.find({ active: true }).sort({ displayOrder: 1, title: 1 }).lean();
    if (!products.length) return [];
    const places = await loadPlaces(models, products);
    const zones = await models.Zone.find({ _id: { $in: [...places.values()].map((location) => location.zoneId) }, active: true }).lean();
    const activeZones = new Set(zones.map((zone) => id(zone._id)));
    const routes = await models.Route.find({ active: true }).lean();
    const rates = await models.Rate.find({ active: true }).lean();
    return products.flatMap((product) => {
      const pickup = places.get(id(product.pickupLocationId));
      const dropoff = places.get(id(product.dropoffLocationId));
      const bookable = (place) => place && place.active !== false && activeZones.has(id(place.zoneId));
      if (!bookable(pickup) || !bookable(dropoff) || id(pickup._id) === id(dropoff._id)) return [];
      const { route, from } = startingPrice(routes, rates, pickup.zoneId, dropoff.zoneId);
      return [{
        slug: product.slug,
        title: product.title,
        tripType: "ONE_WAY",
        pickup: placeView(pickup),
        dropoff: placeView(dropoff),
        description: product.description || "",
        inclusions: product.inclusions || [],
        durationMinutes: route?.durationMinutes ?? null,
        price: from
          ? { status: "PRICED", from, currency: TRANSFER_CURRENCY, basis: "PER_VEHICLE" }
          : { status: "QUOTE_REQUIRED", from: null, currency: TRANSFER_CURRENCY, basis: "PER_VEHICLE" }
      }];
    });
  };

  const listAdmin = async () => {
    const { models } = await getStore();
    const products = await models.PopularRoute.find({}).sort({ displayOrder: 1, title: 1 }).lean();
    const places = await loadPlaces(models, products);
    return products.map((product) => adminView(product, places));
  };

  const checkPlaces = async (models, pickupLocationId, dropoffLocationId, session) => {
    if (id(pickupLocationId) === id(dropoffLocationId)) throw new AppError("Pickup and drop-off must be different places", 422, "TRANSFER_SAME_LOCATION");
    const query = models.Location.countDocuments({ _id: { $in: [pickupLocationId, dropoffLocationId] } });
    if ((await (session ? query.session(session) : query)) !== 2) throw new AppError("Choose existing pickup and drop-off locations", 422, "TRANSFER_LOCATION_NOT_FOUND");
  };

  const audited = async ({ actor, context, action, run }) => {
    const store = await getStore();
    const record = await withTransaction(store, async (session) => {
      const { record: saved, before = null, reason = "" } = await run(store.models, session);
      await recordTransferAudit(store.models, { actor, action, entityType: "TransferPopularRoute", entityId: saved._id, before, after: saved, reason, context }, session);
      return saved;
    });
    return adminView(record.toObject ? record.toObject() : record, await loadPlaces(store.models, [record]));
  };

  const create = ({ actor, context, input }) =>
    audited({
      actor, context, action: "popular_route.created",
      run: async (models, session) => {
        await checkPlaces(models, input.pickupLocationId, input.dropoffLocationId, session);
        const [record] = await models.PopularRoute.create([input], session ? { session } : {});
        return { record };
      }
    });

  const update = ({ actor, context, popularRouteId, input }) =>
    audited({
      actor, context, action: "popular_route.updated",
      run: async (models, session) => {
        if (!mongoose.Types.ObjectId.isValid(String(popularRouteId || ""))) throw notFound();
        const query = models.PopularRoute.findById(popularRouteId);
        const record = await (session ? query.session(session) : query);
        if (!record) throw notFound();
        const before = record.toObject();
        const { reason, ...changes } = input;
        Object.assign(record, changes);
        await checkPlaces(models, record.pickupLocationId, record.dropoffLocationId, session);
        await record.save(session ? { session } : {});
        return { record, before, reason: reason || "" };
      }
    });

  return { listPublic, listAdmin, create, update };
};

module.exports = { createPopularRouteService, startingPrice };
