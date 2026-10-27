import test from "node:test";
import assert from "node:assert/strict";
import {
  activitySummary,
  bookingNotes,
  contactErrors,
  filterHotels,
  formatDeadline,
  formatTripDate,
  freeCancellationDeadline,
  freeCancellationHours,
  paymentChoices,
  priceLines,
  travellersText,
  whatsappHelpHref
} from "../src/components/checkout/checkoutData.js";
import { defaultPhoneCountry, searchPhoneCountries, validatePhone } from "../src/components/checkout/phone.js";

const policy = {
  freeCancellationCutoffValue: 24,
  freeCancellationCutoffUnit: "hours",
  refundable: false,
  policySummary: "Standard Viator policy. Free cancellation is available until 24 hours before departure."
};

test("trip dates read like the mockup", () => {
  assert.equal(formatTripDate("2026-11-10"), "Tue, 10 Nov 2026");
  assert.equal(formatTripDate("2026-11-10", { year: false }), "Tue, 10 Nov");
  assert.equal(formatTripDate("not a date"), "");
});

test("free cancellation ends 24 hours before the start, in Zanzibar time", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  const deadline = freeCancellationDeadline({ travelDate: "2026-11-10", startTime: "07:00", policy, now });
  assert.equal(formatDeadline(deadline), "07:00 on Mon, 9 Nov 2026");
  assert.equal(formatDeadline(deadline, { year: false }), "07:00 on Mon, 9 Nov");
});

test("the quote's own deadline wins, and a passed or missing window shows nothing", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  const own = freeCancellationDeadline({ travelDate: "2026-11-10", startTime: "07:00", policy: { deadline: "2026-11-08T09:30:00+03:00" }, now });
  assert.equal(formatDeadline(own), "09:30 on Sun, 8 Nov 2026");
  assert.equal(freeCancellationDeadline({ travelDate: "2026-11-10", startTime: "07:00", policy, now: new Date("2026-11-09T05:00:00Z") }), null);
  assert.equal(freeCancellationDeadline({ travelDate: "2026-11-10", startTime: "07:00", policy: {}, policyText: "Non-refundable.", now }), null);
});

test("the free-cancellation window comes from the policy text when there is no cutoff", () => {
  assert.equal(freeCancellationHours(null, "Free cancellation is available until 2 days before departure."), 48);
  assert.equal(freeCancellationHours(null, "No refunds."), 0);
});

test("price lines and travellers from the live quote", () => {
  const lines = priceLines({
    currency: "USD",
    lineItems: [
      { label: "Adult", quantity: 2, unitPrice: 170, total: 340 },
      { label: "Child", quantity: 1, unitPrice: 85, total: 85 }
    ],
    discountAmount: 25,
    offer: { name: "Early bird" }
  });
  assert.deepEqual(lines.map((line) => line.label), ["2 adults × $170.00", "1 child × $85.00", "Discount (Early bird)"]);
  assert.equal(lines[0].amount, "$340.00");
  assert.equal(travellersText({ adults: 2, children: 3, infants: 1 }), "2 adults, 3 children, 1 infant");
});

test("contact errors name each missing or wrong field", () => {
  const errors = contactErrors({ firstName: "A", lastName: "", email: "amina@" }, { valid: false, message: "Enter your phone number" });
  assert.deepEqual(Object.keys(errors), ["firstName", "lastName", "email", "phone"]);
  assert.deepEqual(contactErrors({ firstName: "Amina", lastName: "Smith", email: "amina@example.com" }, { valid: true }), {});
});

test("phone numbers are validated for the chosen code and sent as E.164", () => {
  assert.deepEqual(validatePhone("0712 345 678", "TZ"), { valid: true, e164: "+255712345678", country: "TZ", message: "" });
  const ownCode = validatePhone("+44 7911 123456", "TZ");
  assert.equal(ownCode.valid, true);
  assert.equal(ownCode.e164, "+447911123456");
  assert.equal(validatePhone("07911 123456", "GB").country, "GB");
  assert.equal(validatePhone("123", "GB").valid, false);
  assert.equal(validatePhone("", "GB").message, "Enter your phone number");
});

test("the default phone code follows the browser language", () => {
  assert.equal(defaultPhoneCountry(["en-GB"]), "GB");
  assert.equal(defaultPhoneCountry(["en"]), "TZ");
  assert.ok(searchPhoneCountries("+255").some((country) => country.iso === "TZ"));
  assert.ok(searchPhoneCountries("germ").some((country) => country.iso === "DE"));
});

test("hotel search matches every word of the name or address", () => {
  const places = [
    { title: "Coco Reef Ecolodge", address: "Beach Road, Kizimkazi" },
    { title: "Karamba Resort", address: "Dimbani Beach, Kizimkazi" }
  ];
  assert.deepEqual(filterHotels(places, "beach kizimkazi").length, 2);
  assert.deepEqual(filterHotels(places, "coco beach").map((place) => place.title), ["Coco Reef Ecolodge"]);
  assert.equal(filterHotels(places, "").length, 2);
});

test("booking notes carry the room, an unlisted hotel and the guest's requests", () => {
  const notes = bookingNotes(
    { hotelNotListed: true, hotelTyped: "Paradise", hotelName: "Coco Reef Ecolodge", roomNumber: "12", language: "Italian", notes: "Vegetarian" },
    { languageChoosable: true }
  );
  assert.deepEqual(notes.split("\n"), [
    "Hotel not listed – the guest will send it on WhatsApp (typed: Paradise)",
    "Nearest listed hotel, used for the pickup: Coco Reef Ecolodge",
    "Room: 12",
    "Tour language: Italian",
    "Vegetarian"
  ]);
  assert.equal(bookingNotes({ language: "English" }), "");
  assert.equal(activitySummary({ hotel: "Coco Reef Ecolodge", language: "English" }), "Pickup: Coco Reef Ecolodge · English");
  assert.equal(activitySummary({ hasPickup: false, meetingPoint: "Stone Town" }), "Meeting point: Stone Town");
});

test("payment methods appear only with an enabled provider", () => {
  assert.deepEqual(paymentChoices(["pesapal", "dpo", "paypal"]).map((choice) => `${choice.id}:${choice.provider}`), ["card:pesapal", "mobile:pesapal", "paypal:paypal"]);
  assert.deepEqual(paymentChoices(["dpo"]).map((choice) => `${choice.id}:${choice.provider}`), ["card:dpo"]);
  assert.deepEqual(paymentChoices([]), []);
});

test("the WhatsApp help link names the tour, date and option", () => {
  const href = whatsappHelpHref("https://wa.me/255712345678", { title: "Jozani Forest", date: "Tue, 10 Nov 2026", option: "Pickup from Kizimkazi hotels" });
  assert.equal(decodeURIComponent(href.split("?text=")[1]), "Hi, I need help booking Jozani Forest on Tue, 10 Nov 2026 (Pickup from Kizimkazi hotels).");
  assert.equal(whatsappHelpHref("", {}), "");
});
