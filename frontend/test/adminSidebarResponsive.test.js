import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const read = (relativePath) => readFileSync(resolve(root, relativePath), "utf8");

test("admin sidebar redesign reuses one navigation source and split components", () => {
  const sidebar = read("src/components/admin/AdminSidebar.jsx");

  assert.match(sidebar, /filterAdminNavigation\(undefined, user\)/);
  assert.match(sidebar, /const SidebarBrand/);
  assert.match(sidebar, /const SidebarProfile/);
  assert.match(sidebar, /const SidebarSection/);
  assert.match(sidebar, /const SidebarFooter/);
  assert.match(sidebar, /admin-platform-mobile-close/);
  assert.match(sidebar, /const tooltip = item\.label/);
  assert.match(sidebar, /aria-current=\{active \? "page" : undefined\}/);
});

test("admin layout supports persisted collapse state and mobile drawer controls", () => {
  const layout = read("src/layouts/admin/AdminLayout.jsx");
  const topbar = read("src/components/admin/AdminTopBar.jsx");

  assert.match(layout, /riser\.sidebar\.collapsed/);
  assert.match(layout, /LEGACY_SIDEBAR_STATE_KEY/);
  assert.match(layout, /event\.key === "Escape"/);
  assert.match(layout, /document\.body\.style\.overflow = isMobileMenuOpen \? "hidden"/);
  assert.match(layout, /menuButtonRef\.current\?\.focus\(\)/);
  assert.match(topbar, /aria-controls="admin-platform-sidebar"/);
  assert.match(topbar, /ref=\{menuButtonRef\}/);
});

test("admin sidebar CSS covers desktop expanded, collapsed rail, and mobile drawer", () => {
  const styles = read("src/app/styles.css");

  assert.match(styles, /--admin-sidebar-expanded: 260px/);
  assert.match(styles, /--admin-sidebar-collapsed: 72px/);
  assert.match(styles, /\.admin-platform-shell\s*{[\s\S]*grid-template-columns: var\(--admin-sidebar-expanded\)/);
  assert.match(styles, /\.admin-platform-sidebar\.is-collapsed\s*{[\s\S]*width: var\(--admin-sidebar-collapsed\)/);
  assert.match(styles, /\.admin-platform-sidebar\.is-collapsed \[data-tooltip\]::after/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*width: min\(340px, 92vw\)/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*background: var\(--mobile-sidebar-bg\)/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.admin-platform-nav-link\.active[\s\S]*background: #e8f7f5/);
  assert.match(styles, /@media \(max-width: 360px\)[\s\S]*width: min\(320px, 96vw\)/);
});
