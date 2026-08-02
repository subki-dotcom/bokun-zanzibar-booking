const test = require("node:test");
const assert = require("node:assert/strict");

const { internationalPhoneSchema } = require("../src/validators/customer.validation");

test("accepts a normalized international customer phone number", () => {
  assert.equal(internationalPhoneSchema.parse("+255778775044"), "+255778775044");
});

test("rejects local, short, and formatted customer phone numbers at the API boundary", () => {
  ["0778775044", "+25512", "+255 778 775 044"].forEach((phone) => {
    assert.equal(internationalPhoneSchema.safeParse(phone).success, false);
  });
});
