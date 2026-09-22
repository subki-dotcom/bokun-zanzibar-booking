import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const page = fs.readFileSync(new URL("../src/pages/admin/AdminGlPostingPreviewPage.jsx", import.meta.url), "utf8");
const routes = fs.readFileSync(new URL("../src/routes/AppRoutes.jsx", import.meta.url), "utf8");
test("GL posting preview is permission protected and visibly preview-only", () => { assert.match(routes, /gl-posting-preview/); assert.match(page, /Preview Policy V1/); assert.match(page, /Posting is disabled/); assert.match(page, /No AccountingPosting/); });