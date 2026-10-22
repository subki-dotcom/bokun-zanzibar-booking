const test = require("node:test");
const assert = require("node:assert/strict");

// A tour page must not wait for Bókun because of a descriptive gap that never closes (for example Bókun repeating
// parts of pickup addresses). Booking data that is missing still waits, at most once per product every 10 minutes.
const ProductSnapshot = require("../src/models/ProductSnapshot");
const bokunService = require("../src/integrations/bokun");
const toursService = require("../src/services/tours");

const snapshot = (overrides = {}) => ({
  bokunProductId: "990001",
  slug: "gap-tour",
  title: "Gap tour",
  options: [{ bokunOptionId: "77", name: "Morning", active: true }],
  priceCatalogs: [{ catalogId: "1", title: "Default" }],
  pickupPlaces: [{ id: "1", title: "Hotel", address: "Stone Town, Stone Town, TZ" }],
  fromPrice: 30,
  fromPriceBasis: "one_adult_v1",
  fromPriceCheckedAt: new Date(),
  rawBokunProduct: {},
  ...overrides
});

const stubSnapshot = (t, tour) => {
  const findOne = t.mock.method(ProductSnapshot, "findOne", () => ({ lean: async () => tour, select: () => ({ lean: async () => tour }) }));
  t.mock.method(ProductSnapshot, "find", () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(ProductSnapshot, "updateOne", async () => ({}));
  return findOne;
};

test("a descriptive gap is refreshed in the background, not on the visitor's request", async (t) => {
  stubSnapshot(t, snapshot());
  let release;
  const details = t.mock.method(bokunService, "fetchProductDetails", () => new Promise((resolve) => { release = () => resolve(null); }));

  const started = Date.now();
  const tour = await toursService.getTourBySlug("gap-tour", "test");
  assert.equal(tour.slug, "gap-tour");
  assert.ok(Date.now() - started < 200, "answered without waiting for Bókun");
  const callsAfterFirst = details.mock.callCount();

  await toursService.getTourBySlug("gap-tour", "test");
  assert.equal(details.mock.callCount(), callsAfterFirst, "a second visit does not ask Bókun again");
  release?.();
});

test("missing booking data waits for Bókun once, then not again for 10 minutes", async (t) => {
  stubSnapshot(t, snapshot({ bokunProductId: "990002", slug: "no-options", options: [], priceCatalogs: [], pickupPlaces: [] }));
  const details = t.mock.method(bokunService, "fetchProductDetails", async () => null);

  await toursService.getTourBySlug("no-options", "test");
  const first = details.mock.callCount();
  assert.ok(first >= 1, "the first visit asks Bókun for the missing options");
  await toursService.getTourBySlug("no-options", "test");
  assert.equal(details.mock.callCount(), first, "not again on the next visit");
});

test("a tour is read from the database once, then served from memory until it changes", async (t) => {
  const tour = snapshot({ bokunProductId: "990003", slug: "cached-tour", pickupPlaces: [] });
  const findOne = stubSnapshot(t, tour);
  t.mock.method(bokunService, "fetchProductDetails", async () => null);
  t.mock.method(ProductSnapshot, "findOneAndUpdate", () => ({ select: () => ({ lean: async () => ({ ...tour, hiddenFromPublic: true }) }) }));

  await toursService.getTourBySlug("cached-tour", "test");
  const reads = findOne.mock.callCount();
  await toursService.getTourBySlug("cached-tour", "test");
  await toursService.getTourBySlug("cached-tour", "test");
  assert.equal(findOne.mock.callCount(), reads, "later visits do not read the database");

  await toursService.setProductVisibility("990003", true, "staff");
  await toursService.getTourBySlug("cached-tour", "test");
  assert.equal(findOne.mock.callCount(), reads + 1, "a change makes the next visit read the tour again");
});
