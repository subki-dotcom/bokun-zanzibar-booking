const test = require("node:test");
const assert = require("node:assert/strict");

const { mapActivityAvailability } = require("../src/integrations/bokun/bokun.mapper");

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
