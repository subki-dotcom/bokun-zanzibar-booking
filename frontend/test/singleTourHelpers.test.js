import test from "node:test";
import assert from "node:assert/strict";
import { checkoutTags, durationHours, durationTag, excludedForTour, humanizeListItem, importantInfoForTour, tourBadges, tourHasPickup } from "../src/components/tours/single/tourDisplayText.js";

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

test("generic public-transport note is hidden on tours with pickup", () => {
  const info = ["Public transportation is available nearby.", "Bring sunscreen"];
  assert.deepEqual(importantInfoForTour({ importantInformation: info, options: [{ pickupSupported: true }] }), ["Bring sunscreen"]);
  assert.deepEqual(importantInfoForTour({ importantInformation: info, options: [{ pickupSupported: false }] }), info);
  assert.equal(tourHasPickup({ pickupPlaces: [{ id: 1 }] }), true);
  assert.equal(tourHasPickup({}), false);
});

test("duration tags follow the real duration", () => {
  assert.equal(durationHours("7 hours and 30 minutes"), 7.5);
  assert.equal(durationHours("55 minutes").toFixed(2), "0.92");
  assert.equal(durationTag("8 hours", "Day Tour Or Activity"), "Full day");
  assert.equal(durationTag("5 hours"), "Half day");
  assert.equal(durationTag("4 days", "Multi Day Tour"), "4-day tour");
  assert.equal(durationTag("1 hour and 30 minutes", "Transport"), "");
  assert.equal(durationTag(""), "");
  assert.deepEqual(checkoutTags({ duration: "8 hours", options: [{ pickupSupported: true }] }).map((item) => item.text), ["8 hours · Full day", "Hotel pickup"]);
  assert.deepEqual(checkoutTags({}), []);
});

test("pickup is not listed as excluded on tours with pickup", () => {
  const excluded = ["Meeting and pickup", "Lunch", "Hotel pick-up"];
  assert.deepEqual(excludedForTour(excluded, true), ["Lunch"]);
  assert.deepEqual(excludedForTour(excluded, false), excluded);
});
