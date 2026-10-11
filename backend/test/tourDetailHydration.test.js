process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/tour-detail-hydration-test";
process.env.JWT_SECRET ||= "tour-detail-hydration-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const ProductSnapshot = require("../src/models/ProductSnapshot");
const bokunService = require("../src/integrations/bokun");
const mapper = require("../src/integrations/bokun/bokun.mapper");
const { __testables } = require("../src/services/tours");

const bookableTour = (overrides = {}) => ({
  bokunProductId: "product-1",
  slug: "sample-tour",
  options: [{ bokunOptionId: "option-1", name: "Morning" }],
  priceCatalogs: [{ catalogId: "catalog-1" }],
  rawBokunProduct: {},
  ...overrides
});

test("pickup addresses with repeated parts from Bokun are de-duplicated", () => {
  const places = mapper.mapActivityPickupPlaces({
    pickupPlaces: [
      { id: "1", title: "Kiwengwa Beach Hotel", location: { wholeAddress: "Kiwengwa, Kiwengwa", countryCode: "TZ" } },
      { id: "2", title: "Jambiani Lodge", location: { wholeAddress: "Jambiani, Tanzania, , Jambiani, TZ", countryCode: "TZ" } },
      { id: "3", title: "Paje Inn", location: { address: "Paje", city: "Paje", countryCode: "TZ" } }
    ]
  });

  assert.deepEqual(places.map((place) => place.address), ["Kiwengwa, TZ", "Jambiani, Tanzania, TZ", "Paje, TZ"]);
  assert.equal(__testables.hasLegacyContentGap(bookableTour({ pickupPlaces: places })), false);
});

test("empty Bokun agenda items are not treated as a missing itinerary", () => {
  const emptyAgenda = [{ id: 1, title: "", body: "", excerpt: null, photos: [], location: { countryCode: "TZ" } }];
  assert.equal(__testables.hasLegacyContentGap(bookableTour({ rawBokunProduct: { agendaItems: emptyAgenda } })), false);

  const realAgenda = [{ id: 2, title: "Mnemba snorkelling", body: "Snorkel with turtles." }];
  assert.equal(__testables.hasLegacyContentGap(bookableTour({ rawBokunProduct: { agendaItems: realAgenda } })), true);
});

test("an unfillable content gap is re-hydrated at most once per cooldown, not on every view", async (context) => {
  __testables.contentGapHydrationAttemptedAt.clear();
  const fetchProductDetails = context.mock.method(bokunService, "fetchProductDetails", async () => bookableTour({
    rawBokunProduct: { agendaItems: [{ id: 2, title: "Stop", body: "Body" }] }
  }));
  const updateOne = context.mock.method(ProductSnapshot, "updateOne", async () => ({ acknowledged: true }));
  context.mock.method(ProductSnapshot, "findOne", () => ({ lean: async () => bookableTour() }));
  const tour = bookableTour({ rawBokunProduct: { agendaItems: [{ id: 2, title: "Stop", body: "Body" }] } });
  const start = Date.UTC(2026, 9, 8);

  await __testables.hydrateTourOptionsIfNeeded(tour, "req-1", { now: start });
  await __testables.hydrateTourOptionsIfNeeded(tour, "req-2", { now: start + 60 * 1000 });
  await __testables.hydrateTourOptionsIfNeeded(tour, "req-3", { now: start + 5 * 60 * 1000 });
  assert.equal(fetchProductDetails.mock.callCount(), 1);
  assert.equal(updateOne.mock.callCount(), 1);

  await __testables.hydrateTourOptionsIfNeeded(tour, "req-4", { now: start + 31 * 60 * 1000 });
  assert.equal(fetchProductDetails.mock.callCount(), 2);
});

test("booking-critical gaps (fallback options or no price catalogs) are never throttled", async (context) => {
  __testables.contentGapHydrationAttemptedAt.clear();
  const fetchProductDetails = context.mock.method(bokunService, "fetchProductDetails", async () => null);
  context.mock.method(ProductSnapshot, "updateOne", async () => ({ acknowledged: true }));
  const tour = bookableTour({ options: [], priceCatalogs: [] });
  const start = Date.UTC(2026, 9, 8);

  await __testables.hydrateTourOptionsIfNeeded(tour, "req-1", { now: start });
  await __testables.hydrateTourOptionsIfNeeded(tour, "req-2", { now: start + 1000 });
  await __testables.hydrateTourOptionsIfNeeded(tour, "req-3", { now: start + 2000 });

  assert.equal(fetchProductDetails.mock.callCount(), 3);
});
