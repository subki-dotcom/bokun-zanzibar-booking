import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { bokunSyncModeFromPath } from "../src/pages/admin/bokunSyncView.js";

const routesSource = fs.readFileSync(
  path.join(process.cwd(), "src", "routes", "AppRoutes.jsx"),
  "utf8"
);
const pageSource = fs.readFileSync(
  path.join(process.cwd(), "src", "pages", "admin", "AdminBokunSyncPage.jsx"),
  "utf8"
);
const apiSource = fs.readFileSync(
  path.join(process.cwd(), "src", "api", "adminApi.js"),
  "utf8"
);

test("Bokun Sync mode resolver maps submenu routes", () => {
  assert.equal(bokunSyncModeFromPath("/admin/operations/bokun-sync/confirmed-import"), "confirmed-import");
  assert.equal(bokunSyncModeFromPath("/admin/operations/bokun-sync/manual"), "manual");
  assert.equal(bokunSyncModeFromPath("/admin/operations/bokun-sync/single-booking"), "single-booking");
});

test("Bokun Sync action routes no longer point to AdminUnavailablePage placeholders", () => {
  const bokunSyncRouteLines = routesSource
    .split(/\r?\n/)
    .filter((line) =>
      line.includes("path=\"/admin/operations/bokun-sync/") &&
      !line.includes("sync-logs")
    );

  assert.equal(bokunSyncRouteLines.length, 3);
  for (const line of bokunSyncRouteLines) {
    assert.equal(line.includes("AdminUnavailablePage"), false, line.trim());
  }
  assert.ok(routesSource.includes("AdminBokunSyncPage"));
});

test("Bokun Sync page displays live/mock status from the backend status endpoint", () => {
  assert.ok(apiSource.includes("fetchBokunSyncStatus"));
  assert.ok(apiSource.includes("/bokun/admin/sync-status"));
  assert.ok(pageSource.includes("Live Bokun API"));
  assert.ok(pageSource.includes("Bokun live API is configured"));
});
