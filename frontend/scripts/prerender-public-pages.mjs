import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const dist = path.join(root, "dist");
const siteUrl = String(process.env.VITE_SITE_URL || "https://zanzibartoursandsafaris.co.tz").replace(/\/$/, "");
const configuredApi = String(process.env.SEO_API_BASE_URL || process.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
if (!configuredApi) {
  throw new Error("SEO_API_BASE_URL or VITE_API_BASE_URL is required for SEO prerendering; refusing localhost fallback.");
}
if (/^(https?:\/\/)?(localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(configuredApi)) {
  throw new Error("SEO prerendering requires a publicly reachable API URL; localhost is not allowed.");
}
const apiUrl = /\/api$/i.test(configuredApi) ? configuredApi : `${configuredApi}/api`;

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const plainText = (value = "") => String(value)
  .replace(/<[^>]*>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const truncate = (value = "", length = 160) => {
  const text = plainText(value);
  return text.length <= length ? text : `${text.slice(0, length - 1).trim()}...`;
};

const requestJson = async (url) => {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`SEO data request failed (${response.status}): ${url}`);
  const payload = await response.json();
  if (!payload?.success) throw new Error(`SEO data request returned an invalid payload: ${url}`);
  return payload;
};

const fetchActiveTours = async () => {
  const first = await requestJson(`${apiUrl}/tours?page=1&limit=60`);
  const pages = Number(first.meta?.totalPages || 1);
  const tours = [...(first.data || [])];
  for (let page = 2; page <= pages; page += 1) {
    const payload = await requestJson(`${apiUrl}/tours?page=${page}&limit=60`);
    tours.push(...(payload.data || []));
  }
  const unique = new Map();
  tours.forEach((tour) => {
    const slug = String(tour?.slug || "").trim();
    if (slug) unique.set(slug, tour);
  });
  if (!unique.size) throw new Error("SEO generation found no active public tours; refusing to emit an empty tour sitemap.");
  return [...unique.values()];
};

const getTour = async (slug) => (await requestJson(`${apiUrl}/tours/${encodeURIComponent(slug)}`)).data;

const replaceHead = (html, metadata) => html
  .replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(metadata.title)}</title>`)
  .replace(/<meta name="description" content="[^"]*" \/>/i, `<meta name="description" content="${escapeHtml(metadata.description)}" />`)
  .replace("</head>", `${metadata.head}\n  </head>`)
  .replace('<div id="root"></div>', `<div id="root">${metadata.body}</div>`);

const jsonLd = (entries) => `<script id="riser-prerender-schema" type="application/ld+json">${JSON.stringify(entries).replace(/</g, "\\u003c")}</script>`;

const sharedSchema = () => ([
  { "@context": "https://schema.org", "@type": "Organization", "@id": `${siteUrl}/#organization`, name: "Riser Tours & Safaris", url: siteUrl },
  { "@context": "https://schema.org", "@type": "WebSite", "@id": `${siteUrl}/#website`, name: "Riser Tours & Safaris", url: siteUrl, publisher: { "@id": `${siteUrl}/#organization` } }
]);

const metadata = ({ title, description, canonical, image = "", schemas, body }) => ({
  title,
  description,
  body,
  head: [
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    '<meta name="robots" content="index, follow" />',
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : "",
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : "",
    jsonLd(schemas)
  ].filter(Boolean).join("\n    ")
});

const writePage = async (template, pathname, pageMetadata) => {
  const target = pathname === "/" ? path.join(dist, "index.html") : path.join(dist, pathname.slice(1), "index.html");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, replaceHead(template, pageMetadata));
};

const buildTourMarkup = (tour) => {
  const title = plainText(tour.title || "Zanzibar Tour");
  const description = plainText(tour.description || tour.shortDescription || "");
  const highlights = (tour.highlights || []).map(plainText).filter(Boolean).slice(0, 8);
  const itinerary = (tour.itinerary || []).map(plainText).filter(Boolean).slice(0, 12);
  return `<main><article><nav aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/tours">Tours</a> / ${escapeHtml(title)}</nav><h1>${escapeHtml(title)}</h1>${description ? `<p>${escapeHtml(description)}</p>` : ""}${highlights.length ? `<section><h2>Highlights</h2><ul>${highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>` : ""}${itinerary.length ? `<section><h2>Itinerary</h2><ul>${itinerary.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>` : ""}<p><a href="/booking/${escapeHtml(tour.slug)}">Check availability for ${escapeHtml(title)}</a></p></article></main>`;
};

const run = async () => {
  const template = await fs.readFile(path.join(dist, "index.html"), "utf8");
  const tours = await fetchActiveTours();
  const details = await Promise.all(tours.map((tour) => getTour(tour.slug)));
  const homeCanonical = `${siteUrl}/`;
  await writePage(template, "/", metadata({
    title: "Riser Tours & Safaris | Zanzibar Tours & Activities",
    description: "Book Zanzibar tours, activities, transfers, and safaris with live availability and secure checkout.",
    canonical: homeCanonical,
    schemas: sharedSchema(),
    body: '<main><h1>Zanzibar Tours & Activities</h1><p>Discover Zanzibar tours, activities, transfers, and safaris.</p><p><a href="/tours">Browse Zanzibar tours</a></p></main>'
  }));
  await writePage(template, "/tours", metadata({
    title: "Zanzibar Tours & Activities | Riser Tours & Safaris",
    description: "Compare Zanzibar tours and check live availability by date before booking.",
    canonical: `${siteUrl}/tours`,
    schemas: sharedSchema(),
    body: `<main><h1>Zanzibar Tours & Activities</h1><p>Explore available Zanzibar experiences.</p><ul>${details.map((tour) => `<li><a href="/tours/${escapeHtml(tour.slug)}">${escapeHtml(tour.title)}</a></li>`).join("")}</ul></main>`
  }));
  for (const tour of details) {
    const canonical = `${siteUrl}/tours/${encodeURIComponent(tour.slug)}`;
    const description = truncate(tour.shortDescription || tour.description || `Explore ${tour.title} with Riser Tours & Safaris.`);
    const image = String((tour.images || [])[0] || "");
    const schemas = [...sharedSchema(), {
      "@context": "https://schema.org",
      "@type": "TouristTrip",
      "@id": `${canonical}#tour`,
      name: tour.title,
      description,
      url: canonical,
      image: image ? [image] : undefined
    }, {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: homeCanonical },
        { "@type": "ListItem", position: 2, name: "Tours", item: `${siteUrl}/tours` },
        { "@type": "ListItem", position: 3, name: tour.title, item: canonical }
      ]
    }];
    await writePage(template, `/tours/${tour.slug}`, metadata({
      title: `${tour.title} | Riser Tours & Safaris`, description, canonical, image, schemas, body: buildTourMarkup(tour)
    }));
  }
  const urls = [homeCanonical, `${siteUrl}/tours`, ...details.map((tour) => `${siteUrl}/tours/${encodeURIComponent(tour.slug)}`)];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${escapeHtml(url)}</loc></url>`).join("\n")}\n</urlset>\n`;
  await fs.writeFile(path.join(dist, "sitemap.xml"), sitemap);
  console.log(JSON.stringify({ generatedPages: urls.length, generatedTourPages: details.length, sitemap: "dist/sitemap.xml" }));
};

run().catch((error) => {
  console.error(`SEO prerender failed: ${error.message}`);
  process.exitCode = 1;
});