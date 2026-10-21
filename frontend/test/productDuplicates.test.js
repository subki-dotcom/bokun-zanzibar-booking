import test from "node:test";
import assert from "node:assert/strict";
import { duplicateGroupKey } from "../src/utils/productDuplicates.js";

test("titles that differ only in generic words or punctuation share a group", () => {
  assert.equal(duplicateGroupKey("Zanzibar Half Day Trip in Mnemba Island"), duplicateGroupKey("Zanzibar Half Day Trip in Mnemba Island "));
  assert.equal(duplicateGroupKey("Zanzibar: Walking Spice Farm with Local Cooking Class"), duplicateGroupKey("Zanzibar Walking Spice Farm with Local Cooking Class"));
  assert.notEqual(duplicateGroupKey("Prison Island"), duplicateGroupKey("Mnemba Island"));
});
