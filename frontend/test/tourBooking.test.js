import test from "node:test";
import assert from "node:assert/strict";
import { ageLabel, displayOptionName, paxFromCounts, travellerCategories, travellersLabel } from "../src/components/tours/tourPage/bookingHelpers.js";

const config = { pricingCategories: [
  { id: "a", label: "Adult", ticketCategory: "ADULT", minAge: 13, maxAge: 99, defaultQuantity: 1 },
  { id: "c", label: "Child", ticketCategory: "CHILD", minAge: 4, maxAge: 12 },
  { id: "i", label: "Infant", ticketCategory: "INFANT", minAge: 0, maxAge: 3 }
] };

test("traveller categories keep Bókun's age bands and ticket categories", () => {
  const categories = travellerCategories(config);
  assert.deepEqual(categories.map((category) => [category.id, category.ticketCategory]), [["a", "ADULT"], ["c", "CHILD"], ["i", "INFANT"]]);
  assert.equal(ageLabel(categories[0]), "Age 13+");
  assert.equal(ageLabel(categories[1]), "Age 4–12");
  assert.equal(ageLabel({ minAge: null, maxAge: null }), "");
});

test("checkout pax and the summary label come from the counts", () => {
  const categories = travellerCategories(config);
  const pax = paxFromCounts(categories, { a: 2, c: 1, i: 1 });
  assert.deepEqual(pax, { adults: 2, children: 1, infants: 1 });
  assert.equal(travellersLabel(pax), "2 adults, 1 child, 1 infant");
  assert.equal(travellersLabel({ adults: 1, children: 0, infants: 0 }), "1 adult");
});

test("option names drop the W/ prefix", () => {
  assert.equal(displayOptionName("W/Pickup From Kizimkazi Hotels"), "Pickup From Kizimkazi Hotels");
  assert.equal(displayOptionName("Pickup From Any Hotels"), "Pickup From Any Hotels");
});
