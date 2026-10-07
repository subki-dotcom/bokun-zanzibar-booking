const test = require("node:test");
const assert = require("node:assert/strict");

process.env.BOKUN_MOCK_MODE = "false";
process.env.JWT_SECRET = "group-limit-test-secret";
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/group-limit-test";

const client = require("../src/integrations/bokun/bokun.client");
const service = require("../src/services/bokun");
const { mapOption } = require("../src/integrations/bokun/bokun.mapper");

const rates = [
  { id: 1850426, minPerBooking: 1, maxPerBooking: 5, pricedPerPerson: false },
  { id: 2, minPerBooking: 6, maxPerBooking: 15, pricedPerPerson: false },
  { id: 3, minPerBooking: 1, pricedPerPerson: false }
];
const slot = {
  startTimeId: 3433911, startTime: "08:00", date: "2026-10-08", availabilityCount: 15,
  rates,
  pricesByRate: rates.map((rate) => ({
    activityRateId: rate.id, pricePerBooking: { amount: 15, currency: "USD" }
  }))
};
const priceList = { pricesByDateRange: [{ rates: rates.map((rate) => ({
  rateId: rate.id, passengers: [{ pricingCategoryId: 760799, title: "Adult", ticketCategory: "ADULT" }]
})) }] };

test("live option lists, previews and checkout enforce each rate's group limits", async (t) => {
  t.mock.method(client, "request", async ({ path }) => {
    if (path.includes("/availabilities?")) return [slot];
    if (path.includes("/price-list?")) return priceList;
    return { id: 956388, title: "Zanzibar Transfers", rates };
  });

  for (const count of [1, 5, 6, 14]) {
    const payload = {
      productId: "956388", optionId: "1850426", optionIds: ["1850426", "2", "3"],
      travelDate: "2026-10-08", startDate: "2026-10-08", daysWindow: 1,
      pax: { adults: count }, comparedAdults: count
    };
    for (const fetchOptions of [service.fetchOptionAvailabilityMatrix, service.fetchStartingPricePreview]) {
      const result = await fetchOptions(payload);
      const smallGroup = result.options.find((row) => row.optionId === "1850426");
      assert.equal(smallGroup.available, count <= 5);
      assert.equal(smallGroup.lowestPriceForTwo, count <= 5 ? 15 : null);
      if (count <= 5) {
        assert.equal(smallGroup.pricingType, "per_group");
        assert.equal(smallGroup.maxPerBooking, 5);
        assert.equal(result.lowestPriceForTwo.pricingType, "per_group");
        assert.equal(result.lowestPriceForTwo.maxPerBooking, 5);
      }
      assert.equal(result.options.find((row) => row.optionId === "2").available, count >= 6);
      assert.equal(result.options.find((row) => row.optionId === "3").available, true);
    }
    const checkout = await service.fetchAvailability(payload);
    assert.equal(checkout.available, count <= 5);
    assert.equal(checkout.priceCategories[0].maxQuantity, 5);
  }
});

test("per-person and per-group tier previews retain their price units", async (t) => {
  const mixedSlot = {
    ...slot,
    rates: [{ id: 1, pricedPerPerson: true }, { id: 2, pricedPerPerson: false, maxPerBooking: 5 }],
    pricesByRate: [1, 2].map((id) => ({ activityRateId: id, pricePerBooking: { amount: 0 }, pricePerCategoryUnit: [
      { id: 760799, amount: 20, minParticipantsRequired: 1, maxParticipantsRequired: 5 }
    ] }))
  };
  t.mock.method(client, "request", async ({ path }) => path.includes("/availabilities?") ? [mixedSlot] : priceList);
  for (const fetchOptions of [service.fetchOptionAvailabilityMatrix, service.fetchStartingPricePreview]) {
    const result = await fetchOptions({ productId: "956388", travelDate: "2026-10-08", optionIds: ["1", "2"], comparedAdults: 3, pax: { adults: 3 } });
    const person = result.options.find((row) => row.optionId === "1");
    const group = result.options.find((row) => row.optionId === "2");
    assert.equal(person.lowestPriceForTwo, 60);
    assert.equal(person.pricingType, "per_person");
    assert.equal(person.comparedAdults, 3);
    assert.equal(group.lowestPriceForTwo, 20);
    assert.equal(group.pricingType, "per_group");
    assert.equal(result.lowestPriceForTwo.maxPerBooking, 5);
  }
});

test("booking card config carries the price type of the actual starting option", async (t) => {
  t.mock.method(client, "request", async ({ path }) => path.includes("/availabilities?") ? [slot] : priceList);
  const config = await service.fetchProductBookingConfig("pricing-config-test", {
    prefetchedProduct: { bokunProductId: "pricing-config-test", currency: "USD", options: [{ bokunOptionId: "1850426" }], rawBokunProduct: { rates } }
  });
  assert.equal(config.startingFromPrice, 15);
  assert.equal(config.startingPrice.pricingType, "per_group");
  assert.equal(config.startingPrice.maxPerBooking, 5);
});

test("mapped supplier options preserve explicit price units without guessing from titles", () => {
  assert.equal(mapOption({ id: 1, title: "Group tour", pricedPerPerson: true }).pricingType, "per_person");
  const group = mapOption({ id: 2, pricedPerPerson: false, maxPerBooking: 5 });
  assert.equal(group.pricingType, "per_group");
  assert.equal(group.maxPerBooking, 5);
  assert.equal(mapOption({ id: 3, title: "Group tour" }).pricingType, "");
});

test("fallback starting price keeps the supplier's group price and maximum", async (t) => {
  t.mock.method(client, "request", async () => priceList);
  const config = await service.fetchProductBookingConfig("pricing-fallback-test", {
    includeStartingPreview: false,
    prefetchedProduct: { bokunProductId: "pricing-fallback-test", currency: "USD", options: [], rawBokunProduct: {
      rates: [{ id: 1850426, pricedPerPerson: false, maxPerBooking: 5, nextDefaultPrice: 20 }]
    } }
  });
  assert.equal(config.startingFromPrice, 20);
  assert.equal(config.startingPrice.pricingType, "per_group");
  assert.equal(config.startingPrice.maxPerBooking, 5);
});

test("unlimited departure capacity cannot override a rate maximum or mixed-category total", async (t) => {
  t.mock.method(client, "request", async ({ path }) => path.includes("/availabilities?")
    ? [{ ...slot, unlimitedAvailability: true }] : priceList);
  const result = await service.fetchOptionAvailabilityMatrix({
    productId: "956388", optionIds: ["1850426"], travelDate: "2026-10-08",
    pax: { adults: 1 }, priceCategoryParticipants: [
      { categoryId: "760799", quantity: 4 }, { categoryId: "42", quantity: 2 }
    ]
  });
  assert.equal(result.available, false);
  assert.equal(result.options[0].slots[0].status, "insufficient_capacity");
});
