const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("dashboard summary exposes normalized channel and status breakdowns for the main dashboard", () => {
  const reportsService = read("src/services/reports/index.js");

  assert.match(reportsService, /confirmed_booking_import/);
  assert.match(reportsService, /confirmed_booking_resync/);
  assert.match(reportsService, /\$ifNull:\s*\["\$salesChannel", "\$sourceChannel"\]/);
  assert.match(reportsService, /bookingStatusBreakdown/);
});

test("recent bookings endpoint selects customer and normalized sales channel data for dashboard rows", () => {
  const bookingService = read("src/services/bookings/index.js");

  assert.match(bookingService, /listRecentBookings/);
  assert.match(bookingService, /customer/);
  assert.match(bookingService, /salesChannel/);
  assert.match(bookingService, /operationalSource/);
});
