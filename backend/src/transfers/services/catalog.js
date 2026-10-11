const AppError = require("../../utils/AppError");
const { toDecimal, toDecimal128, moneyString } = require("../../utils/money");
const { withTransaction } = require("../db/connection");
const { recordTransferAudit } = require("./audit");
const { findOverlappingTier } = require("../pricing/rules");
const { MAX_PASSENGERS } = require("../pricing/engine");
const { INFANT_PRICING, TRANSFER_CURRENCY } = require("../models");

const MAX_PRICE = "1000000";

const notFound = (entity) => new AppError(`${entity} not found`, 404, "TRANSFER_NOT_FOUND", { entity });
const id = (value) => (value === null || value === undefined ? null : String(value));
const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const withSession = (query, session) => (session ? query.session(session) : query);

const zoneToApi = (zone) =>
  zone && { id: id(zone._id), code: zone.code, name: zone.name, description: zone.description || "", active: zone.active !== false, createdAt: zone.createdAt, updatedAt: zone.updatedAt };

const locationToApi = (location, zonesById = new Map()) =>
  location && {
    id: id(location._id),
    name: location.name,
    type: location.type,
    zoneId: id(location.zoneId),
    zone: zoneToApi(zonesById.get(id(location.zoneId))) || null,
    address: location.address || "",
    aliases: location.aliases || [],
    sortOrder: location.sortOrder || 0,
    active: location.active !== false,
    createdAt: location.createdAt,
    updatedAt: location.updatedAt
  };

const routeToApi = (route, zonesById = new Map()) =>
  route && {
    id: id(route._id),
    fromZoneId: id(route.fromZoneId),
    toZoneId: id(route.toZoneId),
    fromZone: zoneToApi(zonesById.get(id(route.fromZoneId))) || null,
    toZone: zoneToApi(zonesById.get(id(route.toZoneId))) || null,
    bidirectional: Boolean(route.bidirectional),
    durationMinutes: route.durationMinutes ?? null,
    distanceKm: route.distanceKm ?? null,
    notes: route.notes || "",
    active: route.active !== false,
    createdAt: route.createdAt,
    updatedAt: route.updatedAt
  };

const rateToApi = (rate) =>
  rate && {
    id: id(rate._id),
    routeId: id(rate.routeId),
    minPassengers: rate.minPassengers,
    maxPassengers: rate.maxPassengers,
    price: moneyString(rate.price),
    currency: rate.currency || TRANSFER_CURRENCY,
    basis: rate.basis || "PER_VEHICLE",
    active: rate.active !== false,
    createdAt: rate.createdAt,
    updatedAt: rate.updatedAt
  };

const settingsToApi = (settings) => ({
  infantPricing: settings?.infantPricing || INFANT_PRICING.EXCLUDED,
  currency: TRANSFER_CURRENCY,
  updatedAt: settings?.updatedAt || null
});

const zonesMap = async (models, ids, session = null) => {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const zones = await withSession(models.Zone.find({ _id: { $in: unique } }).lean(), session);
  return new Map(zones.map((zone) => [id(zone._id), zone]));
};

const page = (query = {}) => {
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
  const current = Math.max(1, Number(query.page) || 1);
  return { limit, page: current, skip: (current - 1) * limit };
};

const pageMeta = ({ page: current, limit }, total) => ({ page: current, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });

const activeFilter = (value) => (value === "true" || value === true ? true : value === "false" || value === false ? false : undefined);

const assertPrice = (value) => {
  let price;
  try {
    price = toDecimal(value, { allowNegative: false, field: "price" });
  } catch (_error) {
    throw new AppError("Price must be a valid amount", 422, "TRANSFER_INVALID_PRICE");
  }
  if (price.lessThanOrEqualTo(0) || price.greaterThan(MAX_PRICE) || price.decimalPlaces() > 2) {
    throw new AppError("Price must be greater than 0, at most 1,000,000 and have at most 2 decimals", 422, "TRANSFER_INVALID_PRICE");
  }
  return toDecimal128(price.toFixed(2));
};

const assertTier = ({ minPassengers, maxPassengers }) => {
  if (!Number.isInteger(minPassengers) || !Number.isInteger(maxPassengers) || minPassengers < 1 || maxPassengers > MAX_PASSENGERS || minPassengers > maxPassengers) {
    throw new AppError(`Passenger tier must be whole numbers from 1 to ${MAX_PASSENGERS}, with min ≤ max`, 422, "TRANSFER_INVALID_TIER");
  }
};

const createCatalogService = ({ getStore }) => {
  const audited = async ({ actor, context, action, entityType, run }) => {
    const store = await getStore();
    return withTransaction(store, async (session) => {
      const { record, before = null, after, reason = "" } = await run(store.models, session);
      await recordTransferAudit(store.models, { actor, action, entityType, entityId: record._id, before, after: after ?? record, reason, context }, session);
      return record;
    });
  };

  // ---------- Zones ----------
  const listZones = async ({ query = {} } = {}) => {
    const { models } = await getStore();
    const filter = {};
    const active = activeFilter(query.active);
    if (active !== undefined) filter.active = active;
    if (query.search) filter.$or = [{ code: new RegExp(escapeRegex(query.search), "i") }, { name: new RegExp(escapeRegex(query.search), "i") }];
    const zones = await models.Zone.find(filter).sort({ code: 1 }).lean();
    return zones.map(zoneToApi);
  };

  const createZone = async ({ actor, context, input }) =>
    zoneToApi(
      await audited({
        actor, context, action: "zone.created", entityType: "TransferZone",
        run: async (models, session) => {
          const [record] = await models.Zone.create([{ code: input.code, name: input.name, description: input.description || "", active: input.active !== false }], session ? { session } : {});
          return { record };
        }
      })
    );

  const updateZone = async ({ actor, context, zoneId, input }) =>
    zoneToApi(
      await audited({
        actor, context, action: "zone.updated", entityType: "TransferZone",
        run: async (models, session) => {
          const record = await withSession(models.Zone.findById(zoneId), session);
          if (!record) throw notFound("Zone");
          const before = record.toObject();
          ["code", "name", "description", "active"].forEach((field) => {
            if (input[field] !== undefined) record[field] = input[field];
          });
          await record.save(session ? { session } : {});
          return { record, before, reason: input.reason || "" };
        }
      })
    );

  // ---------- Locations ----------
  const listLocations = async ({ query = {} } = {}) => {
    const { models } = await getStore();
    const filter = {};
    const active = activeFilter(query.active);
    if (active !== undefined) filter.active = active;
    if (query.zoneId) filter.zoneId = query.zoneId;
    if (query.type) filter.type = query.type;
    if (query.search) {
      const pattern = new RegExp(escapeRegex(query.search), "i");
      filter.$or = [{ name: pattern }, { address: pattern }, { aliases: pattern }];
    }
    const paging = page(query);
    const [locations, total] = await Promise.all([
      models.Location.find(filter).sort({ sortOrder: 1, name: 1 }).skip(paging.skip).limit(paging.limit).lean(),
      models.Location.countDocuments(filter)
    ]);
    const zones = await zonesMap(models, locations.map((location) => location.zoneId));
    return { items: locations.map((location) => locationToApi(location, zones)), pagination: pageMeta(paging, total) };
  };

  const requireZone = async (models, zoneId, session) => {
    const zone = await withSession(models.Zone.findById(zoneId).lean(), session);
    if (!zone) throw new AppError("Zone not found", 422, "TRANSFER_ZONE_NOT_FOUND", { zoneId });
    return zone;
  };

  const createLocation = async ({ actor, context, input }) => {
    const record = await audited({
      actor, context, action: "location.created", entityType: "TransferLocation",
      run: async (models, session) => {
        await requireZone(models, input.zoneId, session);
        const [created] = await models.Location.create(
          [{ name: input.name, type: input.type, zoneId: input.zoneId, address: input.address || "", aliases: input.aliases || [], sortOrder: input.sortOrder || 0, active: input.active !== false }],
          session ? { session } : {}
        );
        return { record: created };
      }
    });
    const { models } = await getStore();
    return locationToApi(record.toObject(), await zonesMap(models, [record.zoneId]));
  };

  const updateLocation = async ({ actor, context, locationId, input }) => {
    const record = await audited({
      actor, context, action: "location.updated", entityType: "TransferLocation",
      run: async (models, session) => {
        const location = await withSession(models.Location.findById(locationId), session);
        if (!location) throw notFound("Location");
        const before = location.toObject();
        if (input.zoneId !== undefined) await requireZone(models, input.zoneId, session);
        ["name", "type", "zoneId", "address", "aliases", "sortOrder", "active"].forEach((field) => {
          if (input[field] !== undefined) location[field] = input[field];
        });
        await location.save(session ? { session } : {});
        return { record: location, before, reason: input.reason || "" };
      }
    });
    const { models } = await getStore();
    return locationToApi(record.toObject(), await zonesMap(models, [record.zoneId]));
  };

  // ---------- Routes ----------
  const listRoutes = async ({ query = {} } = {}) => {
    const { models } = await getStore();
    const filter = {};
    const active = activeFilter(query.active);
    if (active !== undefined) filter.active = active;
    if (query.zoneId) filter.$or = [{ fromZoneId: query.zoneId }, { toZoneId: query.zoneId }];
    const routes = await models.Route.find(filter).sort({ createdAt: 1 }).lean();
    const zones = await zonesMap(models, routes.flatMap((route) => [route.fromZoneId, route.toZoneId]));
    return routes.map((route) => routeToApi(route, zones));
  };

  // A reverse route may coexist only when neither direction is bidirectional; otherwise one direction
  // would have two possible prices.
  const assertNoDirectionConflict = async (models, { fromZoneId, toZoneId, bidirectional, excludeId = null }, session) => {
    if (String(fromZoneId) === String(toZoneId)) return;
    const reverse = await withSession(models.Route.findOne({ fromZoneId: toZoneId, toZoneId: fromZoneId }).lean(), session);
    if (reverse && String(reverse._id) !== String(excludeId) && (bidirectional || reverse.bidirectional)) {
      throw new AppError("A route already covers the opposite direction. Use one bidirectional route or two one-way routes.", 409, "TRANSFER_ROUTE_DIRECTION_CONFLICT", { routeId: id(reverse._id) });
    }
  };

  const createRoute = async ({ actor, context, input }) => {
    const record = await audited({
      actor, context, action: "route.created", entityType: "TransferRoute",
      run: async (models, session) => {
        await requireZone(models, input.fromZoneId, session);
        await requireZone(models, input.toZoneId, session);
        const bidirectional = input.bidirectional !== false;
        await assertNoDirectionConflict(models, { ...input, bidirectional }, session);
        const [created] = await models.Route.create(
          [{ fromZoneId: input.fromZoneId, toZoneId: input.toZoneId, bidirectional, durationMinutes: input.durationMinutes ?? null, distanceKm: input.distanceKm ?? null, notes: input.notes || "", active: input.active !== false }],
          session ? { session } : {}
        );
        return { record: created };
      }
    });
    const { models } = await getStore();
    return routeToApi(record.toObject(), await zonesMap(models, [record.fromZoneId, record.toZoneId]));
  };

  const updateRoute = async ({ actor, context, routeId, input }) => {
    const record = await audited({
      actor, context, action: "route.updated", entityType: "TransferRoute",
      run: async (models, session) => {
        const route = await withSession(models.Route.findById(routeId), session);
        if (!route) throw notFound("Route");
        const before = route.toObject();
        if (input.bidirectional !== undefined) {
          await assertNoDirectionConflict(models, { fromZoneId: route.fromZoneId, toZoneId: route.toZoneId, bidirectional: input.bidirectional, excludeId: route._id }, session);
        }
        ["bidirectional", "durationMinutes", "distanceKm", "notes", "active"].forEach((field) => {
          if (input[field] !== undefined) route[field] = input[field];
        });
        await route.save(session ? { session } : {});
        return { record: route, before, reason: input.reason || "" };
      }
    });
    const { models } = await getStore();
    return routeToApi(record.toObject(), await zonesMap(models, [record.fromZoneId, record.toZoneId]));
  };

  // ---------- Rates ----------
  const listRates = async ({ query = {} } = {}) => {
    const { models } = await getStore();
    const filter = {};
    const active = activeFilter(query.active);
    if (active !== undefined) filter.active = active;
    if (query.routeId) filter.routeId = query.routeId;
    const rates = await models.Rate.find(filter).sort({ routeId: 1, minPassengers: 1 }).lean();
    return rates.map(rateToApi);
  };

  // Locks the route for this transaction so two concurrent tier edits cannot both pass the overlap check.
  const lockRouteRates = async (models, routeId, session) => {
    const route = await withSession(models.Route.findOneAndUpdate({ _id: routeId }, { $inc: { ratesVersion: 1 } }, { new: true }), session);
    if (!route) throw new AppError("Route not found", 422, "TRANSFER_ROUTE_NOT_FOUND", { routeId });
    return route;
  };

  const assertNoOverlap = async (models, candidate, session, excludeId = null) => {
    if (candidate.active === false) return;
    const rates = await withSession(models.Rate.find({ routeId: candidate.routeId, active: true }).lean(), session);
    const overlap = findOverlappingTier(rates, candidate, { excludeId });
    if (overlap) {
      throw new AppError(
        `Passenger tier ${candidate.minPassengers}–${candidate.maxPassengers} overlaps the existing tier ${overlap.minPassengers}–${overlap.maxPassengers}`,
        409,
        "TRANSFER_RATE_TIER_OVERLAP",
        { rateId: id(overlap._id) }
      );
    }
  };

  const createRate = async ({ actor, context, input }) =>
    rateToApi(
      (
        await audited({
          actor, context, action: "rate.created", entityType: "TransferRate",
          run: async (models, session) => {
            const candidate = { routeId: input.routeId, minPassengers: input.minPassengers, maxPassengers: input.maxPassengers, active: input.active !== false };
            assertTier(candidate);
            const price = assertPrice(input.price);
            await lockRouteRates(models, input.routeId, session);
            await assertNoOverlap(models, candidate, session);
            const [created] = await models.Rate.create([{ ...candidate, price, currency: TRANSFER_CURRENCY, basis: "PER_VEHICLE" }], session ? { session } : {});
            return { record: created };
          }
        })
      ).toObject()
    );

  const updateRate = async ({ actor, context, rateId, input }) =>
    rateToApi(
      (
        await audited({
          actor, context, action: "rate.updated", entityType: "TransferRate",
          run: async (models, session) => {
            const rate = await withSession(models.Rate.findById(rateId), session);
            if (!rate) throw notFound("Rate");
            const before = rate.toObject();
            const candidate = {
              routeId: rate.routeId,
              minPassengers: input.minPassengers ?? rate.minPassengers,
              maxPassengers: input.maxPassengers ?? rate.maxPassengers,
              active: input.active ?? rate.active
            };
            assertTier(candidate);
            await lockRouteRates(models, rate.routeId, session);
            await assertNoOverlap(models, candidate, session, rate._id);
            rate.minPassengers = candidate.minPassengers;
            rate.maxPassengers = candidate.maxPassengers;
            rate.active = candidate.active;
            if (input.price !== undefined) rate.price = assertPrice(input.price);
            await rate.save(session ? { session } : {});
            return { record: rate, before, reason: input.reason || "" };
          }
        })
      ).toObject()
    );

  // ---------- Pricing settings ----------
  const getSettings = async () => {
    const { models } = await getStore();
    return settingsToApi(await models.Settings.findOne({ key: "pricing" }).lean());
  };

  const updateSettings = async ({ actor, context, input }) => {
    const record = await audited({
      actor, context, action: "settings.updated", entityType: "TransferSettings",
      run: async (models, session) => {
        let settings = await withSession(models.Settings.findOne({ key: "pricing" }), session);
        const before = settings ? settings.toObject() : null;
        if (!settings) settings = new models.Settings({ key: "pricing" });
        if (input.infantPricing !== undefined) settings.infantPricing = input.infantPricing;
        await settings.save(session ? { session } : {});
        return { record: settings, before, reason: input.reason || "" };
      }
    });
    return settingsToApi(record);
  };

  return {
    listZones, createZone, updateZone,
    listLocations, createLocation, updateLocation,
    listRoutes, createRoute, updateRoute,
    listRates, createRate, updateRate,
    getSettings, updateSettings
  };
};

module.exports = { createCatalogService, zoneToApi, locationToApi, routeToApi, rateToApi, settingsToApi };
