import test from "node:test";
import assert from "node:assert/strict";
import { cancellationText, freeCancellationWindow, includedLists, itineraryStops, keyFacts, pickupAreasText } from "../src/components/tours/tourPage/tourSectionsData.js";

const tour = {
  duration: "8 hours",
  experienceType: "Day Tour Or Activity",
  groupSize: "Up to 10 people",
  languages: ["English"],
  liveTourGuide: { supported: true, languages: ["English"] },
  cancellationPolicy: "Standard Viator policy. Free cancellation is available until 24 hours before departure. 100% cancellation fee applies when cancelled less than 24 hours before departure.",
  options: [{ name: "W/Pickup From Kizimkazi Hotels", pickupSupported: true }, { name: "Pickup From Any Hotels", pickupSupported: true }],
  included: ["Dolphin boat trip", "FOOD_AND_DRINKS"],
  excluded: ["Lunch", "Meeting and pickup"],
  itineraryItems: [
    { day: 1, index: 1, title: "Jozani", description: "<p>Forest walk</p>", admission: "Admission included" },
    { day: 1, index: 0, title: "Kizimkazi", description: "Dolphins", duration: "2 hours" }
  ]
};

test("key facts come from the tour and leave out what is not known", () => {
  const facts = keyFacts(tour);
  assert.deepEqual(facts.map((fact) => fact.id), ["duration", "cancellation", "pickup", "confirmation", "guide", "group"]);
  assert.equal(facts[0].detail, "Full day, approx.");
  assert.equal(facts[1].detail, "Up to 24 hours before");
  assert.equal(facts[5].title, "Small group");
  assert.equal(facts[5].detail, "Max 10 travelers");
  assert.deepEqual(keyFacts({}).map((fact) => fact.id), ["confirmation"]);
});

test("included lists read as words and never exclude offered pickup", () => {
  assert.deepEqual(includedLists(tour), { included: ["Dolphin boat trip", "Food and drinks"], excluded: ["Lunch"] });
});

test("itinerary follows the real order and shows only known details", () => {
  const stops = itineraryStops(tour);
  assert.deepEqual(stops.map((stop) => stop.title), ["Kizimkazi", "Jozani"]);
  assert.deepEqual(stops[0].meta, ["2 hours"]);
  assert.equal(stops[1].description, "Forest walk");
});

test("pickup areas and the cancellation sentence", () => {
  assert.equal(pickupAreasText(tour), "Kizimkazi hotels, or any Zanzibar hotel");
  const cancellation = cancellationText(tour);
  assert.doesNotMatch(cancellation.text, /Viator/);
  assert.equal(cancellation.emphasis, "24 hours");
  assert.equal(freeCancellationWindow("Non-refundable"), "");
});
