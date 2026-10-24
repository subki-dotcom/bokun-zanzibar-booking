const test = require("node:test");
const assert = require("node:assert/strict");
const { pickBestSellers, pickFeatured, safariFacts, showable, styleTiles, toHomeCard, tourStyles } = require("../src/services/tours/homeCatalog");

test("tours are sorted into travel styles from their titles", () => {
  assert.deepEqual(tourStyles({ title: "Zanzibar Half Day Trip in Mnemba Island" }), ["sea"]);
  assert.deepEqual(tourStyles({ title: "Zanzibar: Stone Town, Spice Farm and Prison Island with Lunch" }), ["cultural"]);
  assert.deepEqual(tourStyles({ title: "Zanzibar: Half-Day Private in Prison Island Tours" }), ["sea", "private"]);
  assert.deepEqual(tourStyles({ title: "4 Day Serengeti Ngorongoro and Tarangire Safari from Zanzibar" }), ["safari"]);
  assert.deepEqual(tourStyles({ title: "Zanzibar Airport / Ferry Transfers - Hotels" }), ["transfers"]);
  assert.deepEqual(tourStyles({ title: "Stone Town Private Walking Tour with Local Guide" }), ["cultural", "private"]);
});

test("safari facts come only from what the product includes", () => {
  assert.deepEqual(
    safariFacts(["Return domestic flights between Zanzibar and Serengeti/Arusha", "Game drives in a 4x4 safari vehicle", "Professional English-speaking safari guide"]),
    ["Fly-in from Zanzibar", "Professional safari guides", "4x4 safari vehicles"]
  );
  assert.deepEqual(safariFacts([]), []);
});

const tour = (id, title, overrides = {}) => ({
  bokunProductId: id,
  slug: `t-${id}`,
  title,
  duration: "3 hours",
  images: ["a.jpg", "b.jpg"],
  fromPrice: 70,
  currency: "USD",
  options: [{ active: true, pickupSupported: true, pricingType: "PER_PERSON" }],
  ...overrides
});

test("a card has a factual badge, meta line and no rating without reviews", () => {
  const card = toHomeCard(tour("1", "Zanzibar: Stone Town, Spice Farm and Prison Island with Lunch", { duration: "8 hours", rating: 4.8 }));
  assert.equal(card.badge, "Lunch included");
  assert.deepEqual(card.meta, ["8 hours", "Culture", "Hotel pickup"]);
  assert.equal(card.rating, 0);
  assert.equal(card.unit, "person");
});

test("only tours with a photo and a price are shown, once per title", () => {
  const cards = [
    tour("1", "Zanzibar Half Day Trip in Mnemba Island"),
    tour("2", "Zanzibar Half Day Trip in Mnemba Island", { images: ["x.jpg", "y.jpg", "z.jpg"] }),
    tour("3", "Spice tour", { fromPrice: 0 }),
    tour("4", "Stone Town walk", { images: [] })
  ].map(toHomeCard);
  const visible = showable(cards, new Map());
  assert.deepEqual(visible.map((card) => card.id), ["2"]);
});

test("featured: staff picks first, otherwise the most booked across styles; best sellers never repeat them", () => {
  const cards = [
    tour("1", "Mnemba Island snorkel"),
    tour("2", "Stone Town walk"),
    tour("3", "Airport Transfers"),
    tour("4", "Nakupenda Sandbank"),
    tour("5", "Spice farm visit")
  ].map(toHomeCard);
  const bookings = new Map([["4", 9], ["3", 20], ["2", 5]]);
  const auto = pickFeatured(cards, bookings, 3);
  assert.equal(auto.source, "auto");
  assert.deepEqual(auto.tours.map((card) => card.id), ["4", "2", "1"]);
  const marked = pickFeatured(cards.map((card) => (card.id === "5" ? { ...card, featured: true } : card)), bookings, 3);
  assert.deepEqual(marked.tours.map((card) => card.id), ["5"]);
  assert.equal(marked.source, "admin");
  const best = pickBestSellers(cards, bookings, auto.tours, 2);
  assert.ok(best.every((card) => !auto.tours.some((featured) => featured.id === card.id)));
  assert.ok(best.every((card) => card.badge !== "New"));
});

test("style tiles count real tours and hide empty styles", () => {
  const tiles = styleTiles([tour("1", "Mnemba Island snorkel"), tour("2", "Airport Transfers", { fromPrice: 15 })].map(toHomeCard));
  assert.deepEqual(tiles.map((tile) => [tile.key, tile.count]), [["sea", 1], ["transfers", 1]]);
  assert.equal(tiles.find((tile) => tile.key === "transfers").fromPrice, 15);
});
