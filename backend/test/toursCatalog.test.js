const test = require("node:test");
const assert = require("node:assert/strict");
const { listingFacts, minutesFromText, readFilters, searchCatalog, toListingCard, withoutRepeatedTitles } = require("../src/services/tours/catalog");

const row = (id, title, overrides = {}, raw = {}) => ({
  bokunProductId: id,
  slug: `t-${id}`,
  title,
  duration: "3 hours",
  images: ["a.jpg", "b.jpg"],
  fromPrice: 70,
  currency: "USD",
  options: [{ active: true, pickupSupported: false, pricingType: "PER_PERSON" }],
  included: [],
  rawBokunProduct: raw,
  ...overrides
});

test("durations from Bókun's fields, or from the text", () => {
  assert.equal(minutesFromText("8 hours"), 480);
  assert.equal(minutesFromText("1 hour and 30 minutes"), 90);
  assert.equal(minutesFromText("2 days"), 2880);
  assert.equal(listingFacts(row("1", "x", { duration: "" }, { durationType: "HOURS", durationHours: 8 })).durationMinutes, 480);
  assert.equal(listingFacts(row("1", "x", { duration: "4 days" })).durationMinutes, 5760);
});

test("facts: start times, free cancellation from the policy rules, pickup, private and lunch", () => {
  const facts = listingFacts(
    row("1", "Private Mnemba trip", { included: ["Seafood lunch", "Snorkel gear"] }, {
      startTimes: [{ hour: 17, minute: 30 }, { hour: 6, minute: 0 }],
      cancellationPolicy: { penaltyRules: [{ cutoffHours: 24, percentage: 100 }, { cutoffHours: 24000, percentage: 0 }] },
      meetingType: "PICK_UP"
    })
  );
  assert.deepEqual(facts.startMinutes, [360, 1050]);
  assert.equal(facts.freeCancellation, true);
  assert.equal(facts.pickup, true);
  assert.equal(facts.privateTour, true);
  assert.equal(facts.lunch, true);
  const strict = listingFacts(row("2", "Stone Town walk", {}, { cancellationPolicy: { penaltyRules: [{ cutoffHours: 0, percentage: 100 }] } }));
  assert.equal(strict.freeCancellation, false);
  assert.equal(strict.pickup, false);
  assert.equal(listingFacts(row("3", "x", { cancellationPolicy: "Free cancellation up to 24 hours" })).freeCancellation, true);
});

test("cards: category label, 'Top rated' only with enough good reviews, meeting point or pickup", () => {
  const sea = toListingCard(row("1", "Mnemba Island snorkel", { rating: 4.7, reviewCount: 18, reviewSource: "Tripadvisor" }, { meetingType: "PICK_UP" }));
  assert.deepEqual(sea.category, { key: "sea", label: "Sea tour" });
  assert.equal(sea.badge, "Top rated");
  assert.equal(sea.meta, "Hotel pickup");
  assert.equal(sea.reviewSource, "Tripadvisor");
  const transfer = toListingCard(row("2", "Zanzibar Airport Transfers"));
  assert.equal(transfer.category.label, "Transfer");
  assert.equal(transfer.meta, "Meeting point");
  assert.notEqual(transfer.badge, "Top rated");
});

test("repeated titles are listed once, keeping the most booked", () => {
  const cards = [row("1", "Zanzibar Half Day Trip in Mnemba Island"), row("2", "Zanzibar Half Day Trip in Mnemba Island "), row("3", "Stone Town walk")].map(toListingCard);
  assert.deepEqual(withoutRepeatedTitles(cards, new Map([["2", 4]])).map((card) => card.id), ["2", "3"]);
});

const catalog = () =>
  [
    row("1", "Mnemba Island snorkel", { fromPrice: 70 }, { startTimes: [{ hour: 7, minute: 0 }], meetingType: "PICK_UP" }),
    row("2", "Sunset dhow cruise", { fromPrice: 50, duration: "2 hours" }, { startTimes: [{ hour: 17, minute: 0 }] }),
    row("3", "Stone Town walk", { fromPrice: 30, duration: "3 hours" }),
    row("4", "4 Day Serengeti Safari from Zanzibar", { fromPrice: 5350, duration: "4 days" }),
    row("5", "Zanzibar Airport Transfers", { fromPrice: 15, duration: "1 hour" }),
    row("6", "Nakupenda sandbank with lunch", { fromPrice: 100, duration: "6 hours", included: ["Lunch"] }, { startTimes: [{ hour: 9, minute: 0 }] })
  ].map(toListingCard);

test("filters combine: category, search, duration, time of day, price and good-to-know", () => {
  const cards = catalog();
  assert.deepEqual(searchCatalog(cards, { category: "sea" }).items.map((card) => card.id).sort(), ["1", "2", "6"]);
  assert.deepEqual(searchCatalog(cards, { category: "Sea tours", time: "evening" }).items.map((card) => card.id), ["2"]);
  assert.deepEqual(searchCatalog(cards, { duration: "multi-day" }).items.map((card) => card.id), ["4"]);
  assert.deepEqual(searchCatalog(cards, { duration: "half-day" }).items.map((card) => card.id), ["6"]);
  assert.deepEqual(searchCatalog(cards, { price: "20-60", sort: "price_asc" }).items.map((card) => card.id), ["3", "2"]);
  assert.deepEqual(searchCatalog(cards, { good: "lunch" }).items.map((card) => card.id), ["6"]);
  assert.deepEqual(searchCatalog(cards, { good: "pickup", q: "mnemba" }).items.map((card) => card.id), ["1"]);
  assert.equal(searchCatalog(cards, { q: "no-such-place" }).total, 0);
});

test("paging, sorting and counts from the whole catalogue", () => {
  const cards = catalog();
  const first = searchCatalog(cards, { limit: "4", sort: "price_desc" });
  assert.equal(first.total, 6);
  assert.equal(first.pages, 2);
  assert.deepEqual(first.items.map((card) => card.fromPrice), [5350, 100, 70, 50]);
  const second = searchCatalog(cards, { limit: "4", sort: "price_desc", page: "2" });
  assert.deepEqual(second.items.map((card) => card.fromPrice), [30, 15]);
  const filtered = searchCatalog(cards, { category: "safari" });
  assert.equal(filtered.facets.total, 6);
  assert.deepEqual(filtered.facets.price, { min: 15, max: 5350 });
  assert.ok(filtered.facets.categories.some((row) => row.key === "sea" && row.count === 3));
  assert.deepEqual(filtered.facets.times.map((row) => row.key), ["morning", "evening"]);
  assert.ok(filtered.facets.good.some((row) => row.key === "lunch"));
  assert.equal(filtered.items[0].facts, undefined);
});

test("unknown filter values are ignored", () => {
  const filters = readFilters({ category: "spaceships", duration: "forever,half-day", sort: "random", page: "-3", price: "abc" });
  assert.equal(filters.category, "");
  assert.deepEqual(filters.duration, ["half-day"]);
  assert.equal(filters.sort, "recommended");
  assert.equal(filters.page, 1);
  assert.equal(filters.priceMin, 0);
});
