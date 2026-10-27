const test = require("node:test");
const assert = require("node:assert/strict");

const { internationalPhoneSchema } = require("../src/validators/customer.validation");

test("accepts a normalized international customer phone number", () => {
  assert.equal(internationalPhoneSchema.parse("+255712345678"), "+255712345678");
});

test("rejects local, short, and formatted customer phone numbers at the API boundary", () => {
  ["0712345678", "+25512", "+255 712 345 678"].forEach((phone) => {
    assert.equal(internationalPhoneSchema.safeParse(phone).success, false);
  });
});
