import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("admin creation form is labeled and navigation is restricted to super admin", async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
  try {
    const Page = (await server.ssrLoadModule("/src/pages/admin/AdminCreateUserPage.jsx")).default;
    const html = renderToStaticMarkup(React.createElement(Page));
    assert.match(html, /Create Admin/);
    assert.match(html, /for="create-admin-email"/);
    assert.equal((html.match(/type="password"/g) || []).length, 2);
    assert.equal((html.match(/autoComplete="new-password"/g) || []).length, 2);
    assert.doesNotMatch(html, /<select/);
    const { filterAdminNavigation } = await server.ssrLoadModule("/src/config/adminNavigation.js");
    assert.match(JSON.stringify(filterAdminNavigation(undefined, "super_admin")), /\/admin\/settings\/create-admin/);
    for (const role of ["admin", "staff", "agent", ""]) {
      assert.doesNotMatch(JSON.stringify(filterAdminNavigation(undefined, role)), /\/admin\/settings\/create-admin/);
    }
  } finally { await server.close(); }
});
