import test from "node:test";
import assert from "node:assert/strict";

import {
  formatCancellationDeadlineParts,
  splitCancellationTimeRemaining
} from "../src/utils/cancellationPolicy.js";

test("formats the cancellation deadline in Zanzibar time", () => {
  const result = formatCancellationDeadlineParts({
    deadline: "2026-08-28T09:30:00+03:00",
    timezone: "Africa/Dar_es_Salaam"
  });

  assert.deepEqual(result, {
    date: "Friday, 28 August 2026",
    time: "9:30 AM",
    timezoneLabel: "Zanzibar time"
  });
});

test("splits the server-based cancellation countdown into stable units", () => {
  const result = splitCancellationTimeRemaining(
    "2026-08-28T09:30:00+03:00",
    new Date("2026-08-01T17:47:52+03:00")
  );

  assert.deepEqual(result, {
    expired: false,
    totalSeconds: 2302928,
    days: 26,
    hours: 15,
    minutes: 42,
    seconds: 8
  });
});

test("never displays a negative cancellation countdown", () => {
  const result = splitCancellationTimeRemaining(
    "2026-08-28T09:30:00+03:00",
    new Date("2026-08-28T09:30:01+03:00")
  );

  assert.equal(result.expired, true);
  assert.equal(result.totalSeconds, 0);
  assert.equal(result.days, 0);
  assert.equal(result.seconds, 0);
});
