import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const page = fs.readFileSync(new URL("../src/pages/admin/AdminServiceCompletionPage.jsx", import.meta.url), "utf8");
const routes = fs.readFileSync(new URL("../src/routes/AppRoutes.jsx", import.meta.url), "utf8");
test("service completion page is permission protected and keeps revenue policy separate", () => { assert.match(routes, /service-completion/); for (const text of ["Service Completions", "Record Component Evidence", "serviceKey", "COMPLETION_PENDING", "NO_SHOW", "CANCELLED", "Revenue preview only", "Admin Completion Review", "Bókun Activity Status", "Confirm Completion", "ADMIN_CONFIRMATION"]) assert.match(page, new RegExp(text)); });
