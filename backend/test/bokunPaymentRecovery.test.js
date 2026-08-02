process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/bokun-payment-recovery-test";
process.env.JWT_SECRET ||= "bokun-payment-recovery-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const bokunService = require("../src/services/bokun");
const bookingsService = require("../src/services/bookings");

test("selects only the exact Bokun external booking reference", () => {
  const match = bokunService.__testables.findExactExternalBookingSearchMatch(
    {
      items: [
        { id: 1, externalBookingReference: "ZNZ-OTHER" },
        { id: 2, externalBookingReference: "ZNZ-TARGET", confirmationCode: "VIA-2" }
      ]
    },
    "ZNZ-TARGET"
  );

  assert.equal(match.id, 2);
  assert.equal(match.confirmationCode, "VIA-2");
});

test("rejects ambiguous Bokun external booking references", () => {
  assert.throws(
    () => bokunService.__testables.findExactExternalBookingSearchMatch(
      {
        items: [
          { id: 1, externalBookingReference: "ZNZ-DUPLICATE" },
          { id: 2, externalBookingReference: "ZNZ-DUPLICATE" }
        ]
      },
      "ZNZ-DUPLICATE"
    ),
    (error) => error.code === "BOKUN_EXTERNAL_REFERENCE_AMBIGUOUS"
  );
});

test("normalizes a confirmed Bokun booking for payment-safe local recovery", () => {
  const snapshot = bookingsService.normalizeBokunRecoverySnapshot({
    expectedBookingReference: "ZNZ-RECOVERY-1",
    bokunBooking: {
      bookingReference: "ZNZ-RECOVERY-1",
      status: "CONFIRMED",
      raw: {
        booking: {
          bookingId: 99284460,
          confirmationCode: "VIA-99284460",
          externalBookingReference: "ZNZ-RECOVERY-1",
          status: "CONFIRMED",
          currency: "USD",
          totalPrice: 1,
          totalPaid: 1,
          customer: {
            firstName: "Test",
            lastName: "Customer",
            email: "test@example.com",
            phoneNumber: "+255700000000",
            country: "TZ"
          },
          activityBookings: [
            {
              productId: 956388,
              title: "Zanzibar Transfers",
              rateId: 2493894,
              rateTitle: "Nungwi transfer",
              date: Date.parse("2026-08-29T00:00:00Z"),
              startTime: "09:30",
              product: { id: 956388, title: "Zanzibar Transfers" },
              pricingCategoryBookings: [
                {
                  pricingCategoryId: 760799,
                  quantity: 1,
                  pricingCategory: { id: 760799, title: "Adult", ticketCategory: "ADULT" }
                }
              ]
            }
          ]
        }
      }
    }
  });

  assert.equal(snapshot.bookingReference, "ZNZ-RECOVERY-1");
  assert.equal(snapshot.bokunBookingId, "99284460");
  assert.equal(snapshot.confirmationCode, "VIA-99284460");
  assert.equal(snapshot.bokunProductId, "956388");
  assert.equal(snapshot.bokunOptionId, "2493894");
  assert.equal(snapshot.travelDate, "2026-08-29");
  assert.equal(snapshot.amount, 1);
  assert.equal(snapshot.amountPaid, 1);
  assert.equal(snapshot.paxSummary.total, 1);
});
