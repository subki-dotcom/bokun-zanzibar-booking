const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("admin bookings list keeps recent bookings compatible while adding paginated mode", () => {
  const service = read("src/services/bookings/index.js");
  const controller = read("src/controllers/bookings.controller.js");

  assert.match(service, /hasListFilterParams/);
  assert.match(service, /String\(params\.paginated \|\| "false"\) === "true"/);
  assert.match(service, /\.skip\(skip\)/);
  assert.match(service, /\.limit\(limit\)/);
  assert.match(service, /countDocuments\(query\)/);
  assert.match(service, /items,\s*\n\s*summary,/);
  assert.match(service, /pagination:/);
  assert.match(controller, /listRecentBookings\(req\.auth \|\| null, req\.query \|\| {}\)/);
});

test("admin bookings list summary exposes source, payment and booking status breakdowns", () => {
  const service = read("src/services/bookings/index.js");

  assert.match(service, /sourceBreakdown/);
  assert.match(service, /paymentStatusBreakdown/);
  assert.match(service, /bookingStatusBreakdown/);
  assert.match(service, /\$ifNull:\s*\["\$salesChannel", "\$sourceChannel"\]/);
  assert.match(service, /bokunOperationalDates/);
});
