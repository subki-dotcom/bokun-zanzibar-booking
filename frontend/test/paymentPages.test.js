import test from "node:test";
import assert from "node:assert/strict";
import { confirmedHref, paymentPageHref, problemKind, screenFor, tripLine, whatsappReferenceHref } from "../src/components/payment/paymentData.js";

const session = { provider: "pesapal", redirectUrl: "https://pay.pesapal.com/iframe/x" };

test("each payment status opens one screen", () => {
  assert.equal(screenFor(null), "loading");
  assert.equal(screenFor({ status: "awaiting_payment", session }), "pay");
  assert.equal(screenFor({ status: "awaiting_payment", session: null }), "problem");
  assert.equal(screenFor({ status: "expired" }), "problem");
  assert.equal(screenFor({ status: "failed" }), "problem");
  assert.equal(screenFor({ status: "processing" }), "processing");
  assert.equal(screenFor({ status: "paid" }), "confirmed");
  assert.equal(screenFor({ status: "cancelled" }), "cancelled");
});

test("the problem screen names the real reason", () => {
  assert.equal(problemKind({ status: "expired" }), "expired");
  assert.equal(problemKind({ status: "failed" }), "failed");
  assert.equal(problemKind({ status: "awaiting_payment" }, true), "load_error");
  assert.equal(problemKind({ status: "expired", trip: { bookable: false, reason: "date_passed" } }), "date_passed");
  assert.equal(problemKind({ status: "failed", trip: { bookable: false, reason: "unavailable" } }), "unavailable");
});

test("links and the trip line", () => {
  assert.equal(paymentPageHref({ reference: "ZNZ-1", key: "abc" }), "/payment-processing?checkoutKey=abc&bookingReference=ZNZ-1");
  assert.equal(confirmedHref({ reference: "ZNZ-1", key: "a b" }), "/booking/confirmed/ZNZ-1?key=a%20b");
  assert.equal(tripLine({ date: "2026-11-10", time: "07:00", travelers: { adults: 2 } }), "Tue, 10 Nov 2026 · 07:00 · 2 adults");
  assert.equal(
    decodeURIComponent(whatsappReferenceHref("https://wa.me/255", "ZNZ-1", "Jozani").split("?text=")[1]),
    "Hi, I need help with my booking ZNZ-1 (Jozani)."
  );
});
