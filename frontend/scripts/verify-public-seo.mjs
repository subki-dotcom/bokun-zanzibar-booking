import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const dist = path.join(process.cwd(), "dist");
const read = (relativePath) => fs.readFile(path.join(dist, relativePath), "utf8");
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const value = (html, pattern) => html.match(pattern)?.[1] || "";

const checkPage = async (relativePath, { canonical, requireTourSchema = false } = {}) => {
  const html = await read(relativePath);
  expect(!html.includes("risertoursandsafaris.co.tz"), `${relativePath}: obsolete SEO domain`);
  expect(/<title>[^<]+<\/title>/.test(html), `${relativePath}: missing title`);
  expect(/<meta name="description" content="[^"]+"/.test(html), `${relativePath}: missing description`);
  expect(html.includes(`<link rel="canonical" href="${canonical}"`), `${relativePath}: canonical mismatch`);
  expect([...html.matchAll(/<link rel="canonical"/g)].length === 1, `${relativePath}: duplicate canonicals`);
  expect(html.includes(`<meta property="og:url" content="${canonical}"`), `${relativePath}: Open Graph URL mismatch`);
  expect(/<meta property="og:title" content="[^"]+"/.test(html), `${relativePath}: missing Open Graph title`);
  expect(/<meta name="twitter:title" content="[^"]+"/.test(html), `${relativePath}: missing Twitter title`);
  expect(/<h1>[^<]+<\/h1>/.test(html), `${relativePath}: missing initial H1`);
  expect(/application\/ld\+json/.test(html), `${relativePath}: missing JSON-LD`);
  const schemas = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .flatMap((match) => JSON.parse(match[1]));
  const origin = "https://zanzibartoursandsafaris.co.tz";
  for (const type of ["Organization", "WebSite"]) {
    expect(schemas.some((schema) => schema["@type"] === type && schema.url === origin), `${relativePath}: ${type} URL mismatch`);
  }
  if (requireTourSchema) {
    expect(schemas.some((schema) => schema["@type"] === "TouristTrip" && schema.url === canonical), `${relativePath}: tour schema URL mismatch`);
    const breadcrumbs = schemas.find((schema) => schema["@type"] === "BreadcrumbList");
    expect(JSON.stringify(breadcrumbs?.itemListElement?.map((item) => item.item)) ===
      JSON.stringify([`${origin}/`, `${origin}/tours`, canonical]), `${relativePath}: breadcrumb URL mismatch`);
  }
  if (requireTourSchema) expect(html.includes("TouristTrip"), `${relativePath}: missing TouristTrip schema`);
  return html;
};

const run = async () => {
  const homepage = await checkPage("index.html", { canonical: "https://zanzibartoursandsafaris.co.tz/" });
  const tours = await checkPage("tours/index.html", { canonical: "https://zanzibartoursandsafaris.co.tz/tours" });
  const sitemap = await read("sitemap.xml");
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const origin = "https://zanzibartoursandsafaris.co.tz";
  expect(urls.every((url) => {
    const parsed = new URL(url);
    return parsed.origin === origin && !parsed.search && !parsed.hash &&
      /^\/(?:tours(?:\/[^/]+)?)?$/.test(parsed.pathname);
  }), "sitemap: unexpected domain or non-public route");
  const robots = await read("robots.txt");
  expect(robots.includes(`Sitemap: ${origin}/sitemap.xml`), "robots: incorrect sitemap domain");
  expect(!robots.includes("risertoursandsafaris.co.tz"), "robots: obsolete domain");
  expect(robots.includes("Disallow: /admin/") && robots.includes("Disallow: /agent/"), "robots: missing private portal exclusions");
  expect(urls.length >= 3, "sitemap: expected homepage, catalog, and at least one tour");
  expect(urls.every((url) => url.startsWith("https://")), "sitemap: non-HTTPS URL found");
  expect(urls.every((url) => !url.includes("?") && !/\/(admin|agent|booking|payment|invoice|login)(\/|$)/.test(url)), "sitemap: private or query URL found");
  expect(new Set(urls).size === urls.length, "sitemap: duplicate URLs found");
  for (const url of urls.filter((entry) => /\/tours\/[^/]+$/.test(entry))) {
    const slug = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
    await checkPage(`tours/${slug}/index.html`, { canonical: url, requireTourSchema: true });
  }
  const tourUrl = urls.find((url) => /\/tours\/[^/]+$/.test(url));
  expect(tourUrl, "sitemap: no tour URL found");
  const slug = tourUrl.split("/").at(-1);
  const tour = await checkPage(`tours/${slug}/index.html`, { canonical: tourUrl, requireTourSchema: true });
  console.log(JSON.stringify({
    homepage: { title: value(homepage, /<title>([^<]+)<\/title>/), canonical: "https://zanzibartoursandsafaris.co.tz/" },
    tours: { title: value(tours, /<title>([^<]+)<\/title>/), canonical: "https://zanzibartoursandsafaris.co.tz/tours" },
    sampleTour: { slug, title: value(tour, /<title>([^<]+)<\/title>/), canonical: tourUrl },
    sitemap: { totalUrls: urls.length, tourUrls: urls.filter((url) => /\/tours\/[^/]+$/.test(url)).length, duplicates: urls.length - new Set(urls).size, invalidUrls: 0 }
  }));
};

run().catch((error) => {
  console.error(`SEO output verification failed: ${error.message}`);
  process.exitCode = 1;
});
