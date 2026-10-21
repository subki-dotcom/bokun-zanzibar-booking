import test from "node:test";
import assert from "node:assert/strict";
import { isSelectableDate, monthWeeks, parseIsoDate } from "../src/components/tours/single/bookingCard/availabilityCalendar.js";

test("month grid starts on Monday and covers every day", () => {
  const weeks = monthWeeks(parseIsoDate("2026-10-01"));
  assert.deepEqual(weeks[0], [null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.equal(weeks.flat().filter(Boolean).length, 31);
  assert.ok(weeks.every((week) => week.length === 7));
});

test("only bookable dates inside the known range can be picked", () => {
  const availability = { startDate: "2026-10-21", endDate: "2026-12-19", dates: new Set(["2026-10-22", "2026-10-24"]) };
  const options = { today: "2026-10-21", availability };
  assert.equal(isSelectableDate("2026-10-20", options), false, "past");
  assert.equal(isSelectableDate("2026-10-22", options), true);
  assert.equal(isSelectableDate("2026-10-23", options), false, "sold out / no times");
  assert.equal(isSelectableDate("2027-01-10", options), true, "beyond the loaded range is checked at booking");
  assert.equal(isSelectableDate("2026-10-23", { today: "2026-10-21", availability: null }), true, "no data blocks nothing");
});
