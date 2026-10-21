import test from "node:test";
import assert from "node:assert/strict";
import { humanizeListItem, tourBadges } from "../src/components/tours/single/tourDisplayText.js";

test("Bókun codes in included/excluded lists are shown as words", () => {
  assert.equal(humanizeListItem("FOOD_AND_DRINKS"), "Food and drinks");
  assert.equal(humanizeListItem("Lunch"), "Lunch");
  assert.equal(humanizeListItem("Personal expenses (souvenirs, tips, etc.)"), "Personal expenses (souvenirs, tips, etc.)");
  assert.equal(humanizeListItem("WIFI"), "WIFI", "a single word in capitals is left alone");
});

test("tour badges keep categories and phrases, never single keyword fragments", () => {
  const tour = { categories: ["Activities"], highlights: ["Prison", "Walking", "with", "Town", "Stone", "Island", "&", "Zanzibar:", "Snorkeling at Nakupenda sandbank"] };
  assert.deepEqual(tourBadges(tour), ["Activities", "Snorkeling at Nakupenda sandbank"]);
  assert.deepEqual(tourBadges({}), []);
});
