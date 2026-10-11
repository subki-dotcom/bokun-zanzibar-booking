const id = (value) => (value === null || value === undefined ? "" : String(value));

// Two passenger tiers overlap when their ranges share at least one passenger count.
const tiersOverlap = (left, right) => left.minPassengers <= right.maxPassengers && right.minPassengers <= left.maxPassengers;

// The active tier on the same route that a new or edited tier would overlap, if any.
const findOverlappingTier = (rates = [], candidate, { excludeId = null } = {}) =>
  rates.find(
    (rate) =>
      rate.active !== false &&
      id(rate.routeId) === id(candidate.routeId) &&
      id(rate._id) !== id(excludeId) &&
      tiersOverlap(rate, candidate)
  ) || null;

module.exports = { tiersOverlap, findOverlappingTier };
