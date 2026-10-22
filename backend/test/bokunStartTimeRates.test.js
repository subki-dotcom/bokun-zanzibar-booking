const test = require("node:test");
const assert = require("node:assert/strict");

const { mapActivityAvailability } = require("../src/integrations/bokun/bokun.mapper");

// Prison Island & Nakupenda (1095724): each start time books one option, but every start time lists both options'
// prices. Booking "Stone Town" at 08:00 was rejected by the supplier ("does not support this start time").
const prices = [
  { activityRateId: 2176526, pricePerPerson: { pricingCategoryWithPrice: [] } },
  { activityRateId: 2176525, pricePerPerson: { pricingCategoryWithPrice: [] } }
];
const rawAvailabilities = [
  { startTimeId: 4335626, startTime: "08:00", availabilityCount: 15, defaultRateId: 2176525, rates: [{ id: 2176525 }], pricesByRate: prices },
  { startTimeId: 4335627, startTime: "08:30", availabilityCount: 15, defaultRateId: 2176525, rates: [{ id: 2176525 }], pricesByRate: prices },
  { startTimeId: 4335628, startTime: "09:00", availabilityCount: 15, defaultRateId: 2176526, rates: [{ id: 2176526 }], pricesByRate: prices }
];
const slotsFor = (optionId, raw = rawAvailabilities) =>
  mapActivityAvailability({ payload: { optionId, pax: { adults: 2 } }, rawAvailabilities: raw }).slots.map((slot) => `${slot.time}#${slot.startTimeId}`);

test("an option gets only the start times whose rates list it", () => {
  assert.deepEqual(slotsFor("2176526"), ["09:00#4335628"]);
  assert.deepEqual(slotsFor("2176525"), ["08:00#4335626", "08:30#4335627"]);
});

test("an option no start time lists has no start times that day", () => {
  const onlyAnyHotels = rawAvailabilities.slice(0, 2);
  assert.deepEqual(slotsFor("2176526", onlyAnyHotels), []);
});

test("without rates lists, the price list still decides", () => {
  const noRates = rawAvailabilities.map(({ rates, ...slot }) => ({ ...slot, pricesByRate: [prices[slot.startTimeId === 4335628 ? 0 : 1]] }));
  assert.deepEqual(slotsFor("2176526", noRates), ["09:00#4335628"]);
});
