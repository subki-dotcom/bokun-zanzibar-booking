const AppError = require("../../utils/AppError");
const { toDecimal, add, moneyString } = require("../../utils/money");
const { INFANT_PRICING, TRANSFER_CURRENCY } = require("../models");

const TRIP_TYPES = Object.freeze({ ONE_WAY: "ONE_WAY", ROUND_TRIP: "ROUND_TRIP" });
const QUOTE_STATUS = Object.freeze({ PRICED: "PRICED", QUOTE_REQUIRED: "QUOTE_REQUIRED" });
const MAX_PASSENGERS = 99;

const id = (value) => (value === null || value === undefined ? "" : String(value));

const count = (value, field, { min = 0 } = {}) => {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < min || number > MAX_PASSENGERS) {
    throw new AppError(`${field} must be a whole number between ${min} and ${MAX_PASSENGERS}`, 422, "TRANSFER_INVALID_PASSENGERS", { field });
  }
  return number;
};

// Adults and children always count toward the price tier; infants count toward vehicle capacity always
// (safety) and toward the price tier only when the pricing settings say so.
const passengerCounts = (passengers = {}, settings = {}) => {
  const adults = count(passengers.adults, "adults", { min: 1 });
  const children = count(passengers.children, "children");
  const infants = count(passengers.infants, "infants");
  const capacity = adults + children + infants;
  if (capacity > MAX_PASSENGERS) {
    throw new AppError(`A booking can carry at most ${MAX_PASSENGERS} passengers`, 422, "TRANSFER_INVALID_PASSENGERS", { field: "passengers" });
  }
  const infantPricing = settings.infantPricing === INFANT_PRICING.COUNTED ? INFANT_PRICING.COUNTED : INFANT_PRICING.EXCLUDED;
  const priced = adults + children + (infantPricing === INFANT_PRICING.COUNTED ? infants : 0);
  return { adults, children, infants, priced, capacity, infantPricing };
};

// The route for one direction: an active route from → to, or an active bidirectional route to → from.
const findRoute = (routes, fromZoneId, toZoneId) => {
  const active = routes.filter((route) => route.active !== false);
  return (
    active.find((route) => id(route.fromZoneId) === id(fromZoneId) && id(route.toZoneId) === id(toZoneId)) ||
    active.find((route) => route.bidirectional && id(route.fromZoneId) === id(toZoneId) && id(route.toZoneId) === id(fromZoneId)) ||
    null
  );
};

const priceLeg = ({ direction, from, to, routes, rates, priced }) => {
  const leg = {
    direction,
    fromLocationId: id(from._id),
    toLocationId: id(to._id),
    fromZone: { id: id(from.zone._id), code: from.zone.code },
    toZone: { id: id(to.zone._id), code: to.zone.code },
    routeId: null,
    rateId: null,
    tier: null,
    basis: "PER_VEHICLE",
    price: null,
    status: QUOTE_STATUS.QUOTE_REQUIRED,
    reason: ""
  };
  const route = findRoute(routes, from.zone._id, to.zone._id);
  if (!route) return { ...leg, reason: "NO_ROUTE" };
  leg.routeId = id(route._id);

  const matches = rates.filter(
    (rate) => rate.active !== false && id(rate.routeId) === id(route._id) && rate.minPassengers <= priced && priced <= rate.maxPassengers
  );
  if (!matches.length) return { ...leg, reason: "NO_RATE_FOR_PASSENGERS" };
  // Overlapping tiers are rejected when saved; if one slips through, ask for a quote rather than guess.
  if (matches.length > 1) return { ...leg, reason: "RATE_CONFLICT" };

  const [rate] = matches;
  return {
    ...leg,
    rateId: id(rate._id),
    tier: { minPassengers: rate.minPassengers, maxPassengers: rate.maxPassengers },
    price: moneyString(toDecimal(rate.price, { allowNegative: false, field: "price" })),
    status: QUOTE_STATUS.PRICED
  };
};

const usableLocation = (location, field) => {
  if (!location || location.active === false) {
    throw new AppError(`The selected ${field} location is not available`, 422, "TRANSFER_LOCATION_UNAVAILABLE", { field });
  }
  if (!location.zone || location.zone.active === false) {
    throw new AppError(`The selected ${field} location is not in an active zone`, 422, "TRANSFER_ZONE_UNAVAILABLE", { field });
  }
  return location;
};

// Prices a one-way or round-trip transfer. Inputs are plain records (locations with their zone, active
// routes and rates, pricing settings), so the same calculation serves quotes, bookings and the admin preview.
const computeQuote = ({ tripType = TRIP_TYPES.ONE_WAY, pickup, dropoff, passengers, settings = {}, routes = [], rates = [] }) => {
  if (!Object.values(TRIP_TYPES).includes(tripType)) {
    throw new AppError("Trip type must be ONE_WAY or ROUND_TRIP", 422, "TRANSFER_INVALID_TRIP_TYPE");
  }
  const from = usableLocation(pickup, "pickup");
  const to = usableLocation(dropoff, "drop-off");
  if (id(from._id) === id(to._id)) {
    throw new AppError("Pickup and drop-off must be different locations", 422, "TRANSFER_SAME_LOCATION");
  }
  const counts = passengerCounts(passengers, settings);

  const legs = [priceLeg({ direction: "OUTBOUND", from, to, routes, rates, priced: counts.priced })];
  if (tripType === TRIP_TYPES.ROUND_TRIP) {
    legs.push(priceLeg({ direction: "RETURN", from: to, to: from, routes, rates, priced: counts.priced }));
  }

  const priced = legs.every((leg) => leg.status === QUOTE_STATUS.PRICED);
  return {
    status: priced ? QUOTE_STATUS.PRICED : QUOTE_STATUS.QUOTE_REQUIRED,
    tripType,
    currency: TRANSFER_CURRENCY,
    passengers: counts,
    legs,
    total: priced ? moneyString(add(...legs.map((leg) => leg.price))) : null,
    reasons: [...new Set(legs.filter((leg) => leg.reason).map((leg) => leg.reason))]
  };
};

module.exports = {
  TRIP_TYPES,
  QUOTE_STATUS,
  MAX_PASSENGERS,
  passengerCounts,
  findRoute,
  computeQuote
};
