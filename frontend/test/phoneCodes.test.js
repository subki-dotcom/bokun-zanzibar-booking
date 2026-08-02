import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDialCodeToPhone,
  replacePhoneDialCode,
  validatePhoneNumber
} from "../src/utils/phoneCodes.js";

const countries = [
  { code: "TZ", dialCode: "+255", title: "Tanzania" },
  { code: "KE", dialCode: "+254", title: "Kenya" }
];

test("normalizes a Tanzanian local number into international format", () => {
  assert.equal(applyDialCodeToPhone("0778 775 044", "TZ", countries), "+255778775044");
});

test("accepts a correctly formatted Tanzanian phone number", () => {
  const result = validatePhoneNumber("+255 778 775 044", "TZ", countries);

  assert.equal(result.isValid, true);
  assert.equal(result.normalized, "+255778775044");
});

test("rejects a number that is too short for the selected country", () => {
  const result = validatePhoneNumber("+25512345", "TZ", countries);

  assert.equal(result.isValid, false);
  assert.match(result.message, /valid Tanzania phone number/i);
});

test("rejects a dial code that does not match the selected country", () => {
  const result = validatePhoneNumber("+254712345678", "TZ", countries);

  assert.equal(result.isValid, false);
  assert.match(result.message, /\+255 country code/i);
});

test("keeps the national number when the selected country changes", () => {
  assert.equal(
    replacePhoneDialCode("+255778775044", "TZ", "KE", countries),
    "+254778775044"
  );
});
