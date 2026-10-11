const test = require("node:test");
const assert = require("node:assert/strict");
const { computeQuote, passengerCounts } = require("../src/transfers/pricing/engine");
const { findOverlappingTier } = require("../src/transfers/pricing/rules");

const zoneA = { _id: "za", code: "A", active: true };
const zoneB = { _id: "zb", code: "B", active: true };
const zoneC = { _id: "zc", code: "C", active: true };
const airport = { _id: "l1", name: "Airport", active: true, zone: zoneA };
const hotelB = { _id: "l2", name: "Hotel B", active: true, zone: zoneB };
const hotelC = { _id: "l3", name: "Hotel C", active: true, zone: zoneC };
const routeAB = { _id: "rAB", fromZoneId: "za", toZoneId: "zb", bidirectional: true, active: true };
const rate1to5 = { _id: "t1", routeId: "rAB", minPassengers: 1, maxPassengers: 5, price: "45", active: true };
const base = { pickup: airport, dropoff: hotelB, routes: [routeAB], rates: [rate1to5], settings: {} };

test("Zone A → Zone B for 1–5 passengers is USD 45 per vehicle, whatever the count inside the tier", () => {
  for (const adults of [1, 3, 5]) {
    const quote = computeQuote({ ...base, passengers: { adults } });
    assert.equal(quote.status, "PRICED");
    assert.equal(quote.total, "45.00");
    assert.equal(quote.currency, "USD");
    assert.equal(quote.legs[0].basis, "PER_VEHICLE");
    assert.deepEqual(quote.legs[0].tier, { minPassengers: 1, maxPassengers: 5 });
  }
});

test("adults and children count toward the price tier", () => {
  const quote = computeQuote({ ...base, passengers: { adults: 3, children: 3 } });
  assert.equal(quote.passengers.priced, 6);
  assert.equal(quote.status, "QUOTE_REQUIRED");
  assert.deepEqual(quote.reasons, ["NO_RATE_FOR_PASSENGERS"]);
  assert.equal(quote.total, null);
});

test("infants always count toward vehicle capacity; their effect on price is configurable", () => {
  const excluded = computeQuote({ ...base, passengers: { adults: 5, infants: 2 } });
  assert.equal(excluded.passengers.capacity, 7);
  assert.equal(excluded.passengers.priced, 5);
  assert.equal(excluded.total, "45.00");

  const counted = computeQuote({ ...base, settings: { infantPricing: "COUNTED" }, passengers: { adults: 5, infants: 2 } });
  assert.equal(counted.passengers.capacity, 7);
  assert.equal(counted.passengers.priced, 7);
  assert.equal(counted.status, "QUOTE_REQUIRED");
});

test("a bidirectional route prices the reverse direction, and a round trip adds both legs", () => {
  const reverse = computeQuote({ ...base, pickup: hotelB, dropoff: airport, passengers: { adults: 2 } });
  assert.equal(reverse.total, "45.00");

  const roundTrip = computeQuote({ ...base, tripType: "ROUND_TRIP", passengers: { adults: 2 } });
  assert.deepEqual(roundTrip.legs.map((leg) => [leg.direction, leg.fromZone.code, leg.toZone.code, leg.price]), [
    ["OUTBOUND", "A", "B", "45.00"],
    ["RETURN", "B", "A", "45.00"]
  ]);
  assert.equal(roundTrip.total, "90.00");
});

test("a one-way route does not price the reverse direction, so a round trip needs a quote", () => {
  const oneWay = { ...routeAB, bidirectional: false };
  const quote = computeQuote({ ...base, routes: [oneWay], tripType: "ROUND_TRIP", passengers: { adults: 2 } });
  assert.equal(quote.status, "QUOTE_REQUIRED");
  assert.equal(quote.legs[0].price, "45.00");
  assert.equal(quote.legs[1].reason, "NO_ROUTE");
  assert.equal(quote.total, null);
});

test("a route without rates, or no route at all, asks for a quote instead of guessing", () => {
  assert.deepEqual(computeQuote({ ...base, dropoff: hotelC, passengers: { adults: 1 } }).reasons, ["NO_ROUTE"]);
  assert.deepEqual(computeQuote({ ...base, rates: [], passengers: { adults: 1 } }).reasons, ["NO_RATE_FOR_PASSENGERS"]);
  assert.deepEqual(computeQuote({ ...base, rates: [{ ...rate1to5, active: false }], passengers: { adults: 1 } }).reasons, ["NO_RATE_FOR_PASSENGERS"]);
  assert.deepEqual(computeQuote({ ...base, routes: [{ ...routeAB, active: false }], passengers: { adults: 1 } }).reasons, ["NO_ROUTE"]);
  const conflicting = [rate1to5, { ...rate1to5, _id: "t2", price: "50" }];
  assert.deepEqual(computeQuote({ ...base, rates: conflicting, passengers: { adults: 1 } }).reasons, ["RATE_CONFLICT"]);
});

test("decimal prices are exact", () => {
  const quote = computeQuote({ ...base, rates: [{ ...rate1to5, price: "45.10" }], tripType: "ROUND_TRIP", passengers: { adults: 1 } });
  assert.equal(quote.total, "90.20");
});

test("invalid requests are rejected", () => {
  const code = (fn) => {
    try {
      fn();
    } catch (error) {
      return error.code;
    }
    return "no error";
  };
  assert.equal(code(() => computeQuote({ ...base, passengers: { adults: 0 } })), "TRANSFER_INVALID_PASSENGERS");
  assert.equal(code(() => computeQuote({ ...base, passengers: { adults: 1.5 } })), "TRANSFER_INVALID_PASSENGERS");
  assert.equal(code(() => computeQuote({ ...base, passengers: { adults: 60, children: 40 } })), "TRANSFER_INVALID_PASSENGERS");
  assert.equal(code(() => computeQuote({ ...base, dropoff: airport, passengers: { adults: 1 } })), "TRANSFER_SAME_LOCATION");
  assert.equal(code(() => computeQuote({ ...base, pickup: { ...airport, active: false }, passengers: { adults: 1 } })), "TRANSFER_LOCATION_UNAVAILABLE");
  assert.equal(code(() => computeQuote({ ...base, pickup: { ...airport, zone: { ...zoneA, active: false } }, passengers: { adults: 1 } })), "TRANSFER_ZONE_UNAVAILABLE");
  assert.equal(code(() => computeQuote({ ...base, pickup: null, passengers: { adults: 1 } })), "TRANSFER_LOCATION_UNAVAILABLE");
  assert.equal(code(() => computeQuote({ ...base, tripType: "MULTI", passengers: { adults: 1 } })), "TRANSFER_INVALID_TRIP_TYPE");
});

test("passenger counting defaults children and infants to zero", () => {
  assert.deepEqual(passengerCounts({ adults: 2 }), { adults: 2, children: 0, infants: 0, priced: 2, capacity: 2, infantPricing: "EXCLUDED" });
});

test("passenger tiers on the same route may not overlap", () => {
  const existing = [{ _id: "t1", routeId: "r", minPassengers: 1, maxPassengers: 5, active: true }];
  assert.equal(findOverlappingTier(existing, { routeId: "r", minPassengers: 6, maxPassengers: 10 }), null);
  assert.equal(findOverlappingTier(existing, { routeId: "r", minPassengers: 5, maxPassengers: 8 })?._id, "t1");
  assert.equal(findOverlappingTier(existing, { routeId: "other", minPassengers: 1, maxPassengers: 5 }), null);
  assert.equal(findOverlappingTier(existing, { routeId: "r", minPassengers: 2, maxPassengers: 4 }, { excludeId: "t1" }), null);
  assert.equal(findOverlappingTier([{ ...existing[0], active: false }], { routeId: "r", minPassengers: 1, maxPassengers: 5 }), null);
});
