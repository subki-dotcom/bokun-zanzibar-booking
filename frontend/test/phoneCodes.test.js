import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDialCodeToPhone,
  browserCountryCode,
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

test("accepts a phone from another country than the selected one", () => {
  const result = validatePhoneNumber("+254712345678", "TZ", countries);

  assert.equal(result.isValid, true);
  assert.equal(result.normalized, "+254712345678");
  assert.equal(validatePhoneNumber("+2541234", "TZ", countries).isValid, false, "still needs 8 to 15 digits");
});

test("changing the country never rewrites a number the guest typed", () => {
  assert.equal(replacePhoneDialCode("+255778775044", "TZ", "KE", countries), "+255778775044");
});

test("changing the country swaps the dial code while no number is typed", () => {
  assert.equal(replacePhoneDialCode("+255", "TZ", "KE", countries), "+254");
  assert.equal(replacePhoneDialCode("", "TZ", "KE", countries), "+254");
});

test("the default country comes from the browser language", () => {
  assert.equal(browserCountryCode(["en-GB", "en"]), "GB");
  assert.equal(browserCountryCode(["de", "fr-CH"]), "CH");
  assert.equal(browserCountryCode(["zh-Hant-TW"]), "TW");
  assert.equal(browserCountryCode(["en"]), "");
});
