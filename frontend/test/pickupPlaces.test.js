import test from "node:test";
import assert from "node:assert/strict";
import { pickupAreaFromOption, pickupPlacesForOption } from "../src/utils/pickupPlaces.js";

const places = [
  { id: "1", title: "Zuri Hotel", address: "Kendwa, TZ" },
  { id: "2", title: "Karafuu Beach", address: "Kizimkazi, TZ" },
  { id: "3", title: "Karafuu Beach", address: "Kizimkazi, TZ " },
  { id: "4", title: "Dolphin View Kizimkazi", address: "" },
  { id: "5", title: "  ", address: "No name" }
];

test("the option name tells the pickup area", () => {
  assert.equal(pickupAreaFromOption("W/Pickup From Kizimkazi Hotels"), "Kizimkazi");
  assert.equal(pickupAreaFromOption("Pickup From Any Hotels"), "");
  assert.equal(pickupAreaFromOption("Private tour"), "");
});

test("pickup list: area places only, no duplicates or blanks, sorted", () => {
  assert.deepEqual(pickupPlacesForOption(places, "W/Pickup From Kizimkazi Hotels").map((place) => place.id), ["4", "2"]);
  assert.deepEqual(pickupPlacesForOption(places, "Pickup From Any Hotels").map((place) => place.id), ["4", "2", "1"]);
  assert.deepEqual(pickupPlacesForOption(places, "Pickup from Paje hotels").map((place) => place.id), ["4", "2", "1"], "no match keeps every hotel");
});
