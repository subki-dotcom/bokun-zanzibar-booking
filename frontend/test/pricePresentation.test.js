import test from "node:test";
import assert from "node:assert/strict";
import { pricePresentation } from "../src/components/tours/single/pricePresentation.js";

test("a $20 group price stays $20 and names the supplier group limit", () => {
  for (const comparedAdults of [1, 2, 5]) {
    assert.deepEqual(pricePresentation({ amount: 20, pricingType: "per_group", maxPerBooking: 5, comparedAdults, isTotal: true }),
      { amount: 20, label: "per group up to 5" });
  }
});

test("per-person previews use the actual comparison count instead of dividing by two", () => {
  assert.deepEqual(pricePresentation({ amount: 60, pricingType: "per_person", comparedAdults: 3, isTotal: true }),
    { amount: 20, label: "per person" });
  assert.deepEqual(pricePresentation({ amount: 20, pricingType: "per_person" }),
    { amount: 20, label: "per person" });
});

test("missing supplier metadata never invents a per-person price or group limit", () => {
  assert.deepEqual(pricePresentation({ amount: 20, isTotal: true }), { amount: 20, label: "total" });
  assert.equal(pricePresentation({ pricingType: "per_group" }).label, "per group");
});
