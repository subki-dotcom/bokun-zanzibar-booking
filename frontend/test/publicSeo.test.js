import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const seoHead = fs.readFileSync(new URL("../src/components/common/SeoHead.jsx", import.meta.url), "utf8");
const publicLayout = fs.readFileSync(new URL("../src/layouts/PublicLayout.jsx", import.meta.url), "utf8");
const sitemap = fs.readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8");
const prerender = fs.readFileSync(new URL("../scripts/prerender-public-pages.mjs", import.meta.url), "utf8");
const detailPage = fs.readFileSync(new URL("../src/pages/public/TourDetailsPage.jsx", import.meta.url), "utf8");

test("public SEO keeps canonical URLs query-free and supports noindex routes", () => {
  assert.match(seoHead, /\$\{BRAND\.website\}\$\{window\.location\.pathname\}/);
  assert.match(seoHead, /noindex, nofollow/);
  assert.match(seoHead, /TouristTrip/);
  assert.match(publicLayout, /noIndexRoute/);
  assert.match(publicLayout, /booking-confirmation/);
  assert.match(publicLayout, /payment-status/);
});

test("static sitemap contains only implemented indexable public routes", () => {
  assert.match(sitemap, /https:\/\/zanzibartoursandsafaris\.co\.tz\/tours/);
  assert.doesNotMatch(sitemap, /\/contact/);
});

test("robots excludes private portals from crawling", () => {
  const robots = fs.readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8");
  assert.match(robots, /Disallow: \/admin\//);
  assert.match(robots, /Disallow: \/agent\//);
});

test("prerender generates active tour pages and fails safely without public data", () => {
  assert.match(prerender, /fetchActiveTours/);
  assert.match(prerender, /\/tours\?page=1&limit=60/);
  assert.match(prerender, /refusing to emit an empty tour sitemap/);
  assert.match(prerender, /refusing localhost fallback/);
  assert.match(prerender, /localhost is not allowed/);
  assert.match(prerender, /TouristTrip/);
  assert.match(prerender, /BreadcrumbList/);
});

test("invalid tour details are explicitly noindex", () => {
  assert.match(detailPage, /Tour Not Found/);
  assert.match(detailPage, /noIndex/);
});