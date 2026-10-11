process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/booking-line-items-test";
process.env.JWT_SECRET ||= "booking-line-items-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const Booking = require("../src/models/Booking");

test("booking pricing snapshot keeps quote line item quantity, unit price and total", () => {
  const booking = new Booking({
    pricingSnapshot: {
      currency: "USD",
      finalPayable: 170,
      lineItems: [
        { label: "Adult", quantity: 2, unitPrice: 85, total: 170 },
        { label: "Legacy import line", amount: 40 }
      ]
    }
  });

  const [quoteLine, legacyLine] = booking.pricingSnapshot.lineItems.map((item) => item.toObject());
  assert.equal(quoteLine.quantity, 2);
  assert.equal(quoteLine.unitPrice, 85);
  assert.equal(quoteLine.total, 170);
  assert.equal(legacyLine.amount, 40);
});
