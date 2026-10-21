import test from "node:test";
import assert from "node:assert/strict";
import { freeCancellationLabel, tourQuestionWhatsappHref } from "../src/components/tours/single/bookingCard/bookingTrust.js";

test("free cancellation is taken from the real policy", () => {
  assert.equal(freeCancellationLabel("Standard Viator policy. Free cancellation is available until 24 hours before departure. 100% fee applies."), "Free cancellation up to 24 hours before");
  assert.equal(freeCancellationLabel("Strict policy. Free cancellation is available until 6 days before departure."), "Free cancellation up to 6 days before");
  assert.equal(freeCancellationLabel("Non-refundable."), "");
});

test("the WhatsApp question names the tour", () => {
  assert.equal(tourQuestionWhatsappHref("https://wa.me/255778775044", "Safari Blue"), "https://wa.me/255778775044?text=" + encodeURIComponent("Hello, I have a question about \"Safari Blue\"."));
  assert.equal(tourQuestionWhatsappHref("", "x"), "");
});
