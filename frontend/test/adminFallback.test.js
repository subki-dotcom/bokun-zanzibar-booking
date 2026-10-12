import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRoutesFromChildren } from "react-router-dom";
import { createServer } from "vite";
import { sharedResolve } from "../../shared/vite.shared.js";

const routes = fs.readFileSync(path.join(process.cwd(), "src", "routes", "AppRoutes.jsx"), "utf8");
const adminRoutesFile = path.resolve(process.cwd(), "..", "backoffice", "src", "routes", "AdminRoutes.jsx").replaceAll("\\", "/");

let server;
before(async () => {
  server = await createServer({ configFile: false, resolve: sharedResolve, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
});
after(async () => {
  await server?.close();
});

test("the website keeps /admin as a fallback that mounts the Back Office route table", () => {
  assert.match(routes, /import adminRoutes from "\.\.\/\.\.\/\.\.\/backoffice\/src\/routes\/AdminRoutes";/);
  assert.match(routes, /\{adminRoutes\(\)\}/);
  assert.doesNotMatch(routes, /pages\/admin\//, "admin pages are owned by the Back Office");
});

test("the fallback resolves to the website's own React Router, so there is a single router instance", async () => {
  const { default: adminRoutes } = await server.ssrLoadModule(adminRoutesFile);
  // createRoutesFromChildren rejects <Route> elements from a different react-router copy.
  const [layout] = createRoutesFromChildren(adminRoutes());
  // Admin screens sit in role/permission groups under the layout (Back Office screens, Tour Admin screens).
  const paths = (routes) => routes.flatMap((route) => [route.path, ...paths(route.children || [])]);
  assert.ok(paths(layout.children).includes("/admin"));
  assert.ok(paths(layout.children).includes("/admin/tour-admin"));
});

test("public and agent routes are unchanged", () => {
  for (const pathName of ["/tours", "/tours/:slug", "/booking/:slug", "/payment/checkout/:reference", "/payment-status/:reference", "/my-booking/:reference", "/invoice/:bookingReference", "/login", "/agent-register", "/forgot-password", "/reset-password"]) {
    assert.ok(routes.includes(`path="${pathName}"`), pathName);
  }
  assert.match(routes, /<ProtectedRoute roles=\{\["agent"\]\}>\s*<AgentLayout \/>/);
  assert.equal((routes.match(/<Route path="\/agent[/"]/g) || []).length, 20);
});
