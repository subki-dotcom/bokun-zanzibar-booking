const test = require("node:test");
const assert = require("node:assert/strict");

const { mapActivityAvailability } = require("../src/integrations/bokun/bokun.mapper");

const transferAvailability = (quantity, overrides = {}) => mapActivityAvailability({
  payload: { optionId: "1850426", pax: { adults: quantity }, ...overrides },
  rawAvailabilities: [{
    startTimeId: 3433911, startTime: "08:00", availabilityCount: 15,
    rates: [{ id: 1850426, minPerBooking: 1, maxPerBooking: 5, pricedPerPerson: false }],
    pricesByRate: [{ activityRateId: 1850426, pricePerBooking: { amount: 15, currency: "USD" } }]
  }],
  priceList: { pricesByDateRange: [{ rates: [{ rateId: 1850426, passengers: [
    { pricingCategoryId: 760799, title: "Adult", ticketCategory: "ADULT" }
  ] }] }] }
});

test("transfer admits 1 through 5 people at the group price and caps the passenger selector", () => {
  for (const quantity of [1, 5]) {
    const result = transferAvailability(quantity);
    assert.equal(result.available, true);
    assert.equal(result.pricing.grossAmount, 15);
    assert.equal(result.priceCategories[0].maxQuantity, 5);
  }
});

test("transfer rejects 6 and 14 people despite 15 departure seats remaining", () => {
  for (const quantity of [6, 14]) {
    const result = transferAvailability(quantity);
    assert.equal(result.available, false);
    assert.equal(result.slots[0].status, "insufficient_capacity");
  }
});

test("transfer checks the full category total, including a mix of passengers", () => {
  const result = transferAvailability(1, { priceCategoryParticipants: [
    { categoryId: "760799", quantity: 4 }, { categoryId: "42", quantity: 2 }
  ] });
  assert.equal(result.available, false);
});

test("keeps passenger categories for per-booking live quotes", () => {
  const result = mapActivityAvailability({
    payload: {
      optionId: "555",
      travelDate: "2026-10-31",
      startTime: "08:00",
      pax: { adults: 1 }
    },
    rawAvailabilities: [
      {
        startTimeId: 101,
        startTime: "08:00",
        availabilityCount: 10,
        defaultRateId: 555,
        rates: [{ id: 555, title: "Private transfer", pricedPerPerson: false }],
        pricesByRate: [
          {
            activityRateId: 555,
            pricePerBooking: { amount: 100, currency: "USD" }
          }
        ]
      }
    ],
    priceList: {
      pricesByDateRange: [
        {
          rates: [
            {
              rateId: 555,
              passengers: [
                {
                  pricingCategoryId: 42,
                  title: "Adult",
                  ticketCategory: "ADULT",
                  minPerBooking: 1,
                  maxPerBooking: 8
                }
              ]
            }
          ]
        }
      ]
    },
    defaultCurrency: "USD"
  });

  assert.deepEqual(result.priceCategories, [
    {
      categoryId: "42",
      title: "Adult",
      ticketCategory: "ADULT",
      quantity: 0,
      minQuantity: 1,
      maxQuantity: 8
    }
  ]);
});
