const test = require("node:test");
const assert = require("node:assert/strict");

process.env.BOKUN_MOCK_MODE = "false";
process.env.JWT_SECRET = "group-limit-test-secret";
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/group-limit-test";

const client = require("../src/integrations/bokun/bokun.client");
const service = require("../src/services/bokun");

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
      assert.equal(result.options.find((row) => row.optionId === "2").available, count >= 6);
      assert.equal(result.options.find((row) => row.optionId === "3").available, true);
    }
    const checkout = await service.fetchAvailability(payload);
    assert.equal(checkout.available, count <= 5);
    assert.equal(checkout.priceCategories[0].maxQuantity, 5);
  }
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
