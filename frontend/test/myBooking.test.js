import test from "node:test";
import assert from "node:assert/strict";
import {
  countdownTile,
  dayBeforeLabel,
  daysToGoText,
  instantDayTime,
  instantWeekdayDayTime,
  longDate,
  policyBar,
  shareText,
  shortDate,
  ticketDate,
  whatsappTripHref
} from "../src/components/myBooking/myBookingData.js";

test("dates read as in the mockups, whatever the visitor's time zone", () => {
  assert.equal(longDate("2026-11-30"), "Monday, 30 November 2026");
  assert.equal(shortDate("2026-11-30"), "Mon, 30 Nov");
  assert.equal(ticketDate("2026-11-30"), "30 Nov 2026");
  assert.equal(dayBeforeLabel("2026-11-30"), "Sun");
  // 06:00 UTC is 09:00 in Zanzibar.
  assert.equal(instantDayTime("2026-11-29T06:00:00.000Z"), "29 Nov, 09:00");
  assert.equal(instantWeekdayDayTime("2026-11-29T09:00:00+03:00"), "Sun, 29 Nov, 09:00");
});

test("days to go, today and completed", () => {
  assert.equal(daysToGoText({ phase: "upcoming", daysToGo: 34 }), "34 days to go");
  assert.equal(daysToGoText({ phase: "upcoming", daysToGo: 1 }), "Tomorrow");
  assert.equal(daysToGoText({ phase: "today", daysToGo: 0 }), "Today");
  assert.equal(daysToGoText({ phase: "past", daysToGo: null }), "");
  assert.deepEqual(countdownTile({ phase: "upcoming", daysToGo: 34, status: "confirmed" }), { big: "34", label: "Days to go", caption: "Get ready!" });
  assert.equal(countdownTile({ phase: "today", daysToGo: 0, status: "confirmed" }).label, "Today");
  assert.equal(countdownTile({ phase: "past", daysToGo: null, status: "completed" }).caption, "Leave a review");
});

test("the policy bar is green until the deadline and red after", () => {
  const span = { deadlineAt: "2026-11-29T06:00:00.000Z", tripAt: "2026-11-30T06:00:00.000Z" };
  const now = Date.parse("2026-10-27T06:00:00.000Z");
  const bar = policyBar({ policy: { span }, now });
  assert.ok(bar.freePercent > 97 && bar.freePercent < 100);
  assert.equal(bar.deadlinePassed, false);
  const late = policyBar({ policy: { span }, now: Date.parse("2026-11-29T18:00:00.000Z") });
  assert.equal(late.freePercent, 0);
  assert.equal(late.deadlinePassed, true);
  assert.equal(policyBar({ policy: {}, now }), null);
});

test("sharing never includes the reference or a private link", () => {
  const text = shareText({ reference: "ZNZ-7F3K9Q2M", tour: { title: "Zanzibar Transfers" }, date: "2026-11-30", startTime: "09:00" });
  assert.equal(text, "I'm going on Zanzibar Transfers on Monday, 30 November 2026 at 09:00 (Zanzibar time)!");
  assert.ok(!text.includes("ZNZ-") && !text.includes("http"));
});

test("the WhatsApp help message is pre-filled with the reference", () => {
  const href = whatsappTripHref("https://wa.me/255712345678", "ZNZ-7F3K9Q2M", "Zanzibar Transfers");
  assert.match(decodeURIComponent(href), /booking ZNZ-7F3K9Q2M \(Zanzibar Transfers\)/);
});
