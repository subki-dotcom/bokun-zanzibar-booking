const test = require("node:test");
const assert = require("node:assert/strict");

process.env.BOKUN_MOCK_MODE = "true";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/bokun-test";

const bokunService = require("../src/services/bokun");
const { mapActivityAvailability } = require("../src/integrations/bokun/bokun.mapper");

const basePayload = {
  productId: "101",
  optionId: "201",
  travelDate: "2026-08-20",
  startTime: "09:00",
  startTimeId: "401",
  priceCategoryParticipants: [
    { categoryId: "301", quantity: 1, title: "Adult", ticketCategory: "ADULT" }
  ],
  customer: {
    firstName: "Asha",
    lastName: "Juma",
    email: "asha@example.com",
    phone: "+255778775044",
    country: "TZ",
    hotelName: "Tembo House Hotel"
  }
};

test("maps a required pickup question from the existing customer hotel field", async () => {
  const resolved = await bokunService.resolveBookingQuestions(basePayload, "test_booking_answers");
  const pickup = resolved.bookingQuestions.find((question) => question.questionId === "pickup_location");

  assert.equal(pickup?.answer, "Tembo House Hotel");
  assert.equal(pickup?.scope, "booking");
});

test("does not silently invent required passenger answers", async () => {
  const resolved = await bokunService.resolveBookingQuestions(basePayload, "test_booking_answers");
  const passengerQuestion = resolved.missing.find((question) => question.questionId === "passport_name");

  assert.equal(passengerQuestion?.scope, "passenger");
});

test("puts resolved booking answers in the Bókun activity request", () => {
  const checkoutPayload = bokunService.buildCheckoutPayload({
    ...basePayload,
    bookingQuestions: [
      {
        questionId: "pickup_location",
        label: "Pickup hotel/location",
        scope: "booking",
        answer: "Tembo House Hotel"
      }
    ]
  });

  assert.deepEqual(checkoutPayload.directBooking.activityBookings[0].answers, [
    {
      questionId: "pickup_location",
      values: ["Tembo House Hotel"]
    }
  ]);
  assert.equal(checkoutPayload.directBooking.activityBookings[0].startTimeId, 401);
});

test("does not treat a display time as a Bókun start-time identifier", () => {
  const checkoutPayload = bokunService.buildCheckoutPayload({
    ...basePayload,
    startTimeId: undefined
  });

  assert.equal(Object.hasOwn(checkoutPayload.directBooking.activityBookings[0], "startTimeId"), false);
});

test("preserves the live Bokun startTimeId when availability uses a nested start-time object", () => {
  const availability = mapActivityAvailability({
    payload: {
      optionId: "201",
      travelDate: "2026-08-20",
      startTime: "09:00",
      startTimeId: "401",
      pax: { adults: 1, children: 0, infants: 0 }
    },
    rawAvailabilities: [
      {
        unlimitedAvailability: true,
        startTime: { id: "401", time: "09:00" },
        rates: [
          {
            id: 201,
            pricePerBooking: { amount: 70, currency: "USD" }
          }
        ]
      }
    ]
  });

  assert.deepEqual(availability.slots, [
    {
      time: "09:00",
      startTimeId: "401",
      capacityLeft: 9999,
      status: "available"
    }
  ]);
});
