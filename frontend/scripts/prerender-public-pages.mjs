import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

const root = process.cwd();
const dist = path.join(root, "dist");
const brandName = String(process.env.VITE_BRAND_NAME || "Riser Tours & Safaris").trim();
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A busy or waking API (502/503/504, network errors) is retried a few times before the build gives up.
const requestJson = async (url, attempts = 4) => {
  for (let attempt = 1; ; attempt += 1) {
    let retryable = true;
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      retryable = response.status >= 500;
      if (!response.ok) throw new Error(`SEO data request failed (${response.status}): ${url}`);
      const payload = await response.json();
      if (!payload?.success) {
        retryable = false;
        throw new Error(`SEO data request returned an invalid payload: ${url}`);
      }
      return payload;
    } catch (error) {
      if (!retryable || attempt >= attempts) throw error;
      console.warn(`${error.message}; retrying (${attempt}/${attempts - 1})`);
      await sleep(2000 * attempt);
    }
  }
};

// Two tours at a time, so the build does not flood the API.
const mapInBatches = async (items, fn, size = 2) => {
  const results = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...(await Promise.all(items.slice(index, index + size).map(fn))));
  }
  return results;
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

// The home sections' data (style tiles, featured tours…); without it the page still renders its hero and search.
const fetchHomeData = async () => {
  try {
    return (await requestJson(`${apiUrl}/tours/home`)).data || null;
  } catch (error) {
    console.warn(`Home data unavailable, home page prerendered without tour sections: ${error.message}`);
    return null;
  }
};

// The real home page components rendered to HTML, so the page shows at once with the site's own styles.
const renderHome = async (home) => {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "error",
    esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true },
    appType: "custom"
  });
  try {
    const view = await server.ssrLoadModule("/src/components/homePage/HomeView.jsx");
    // Router links use layout effects, which React reports as unused on the server; the page is rendered again in
    // the browser, so that one warning is left out of the build log.
    const logError = console.error;
    console.error = (message, ...rest) => {
      if (!String(message).includes("useLayoutEffect does nothing on the server")) logError(message, ...rest);
    };
    // The site header as the browser draws it at that address (the tour page hides it on phones).
    const SiteHeader = (await server.ssrLoadModule("/src/components/common/siteHeader/SiteHeader.jsx")).default;
    const render = (path, element) => renderToString(React.createElement(MemoryRouter, { initialEntries: [path] }, element));
    const headerAt = (path, variant = "default", wrapClass = "") => {
      const element = React.createElement(SiteHeader, { variant });
      return render(path, wrapClass ? React.createElement("div", { className: wrapClass }, element) : React.createElement("div", null, element));
    };
    // The information pages (About, Contact, FAQ…) and their text, from src/config/sitePages.js.
    const { SITE_PAGES } = await server.ssrLoadModule("/src/config/sitePages.js");
    let html;
    let headers;
    try {
      html = headerAt("/", "transparent") + render("/", React.createElement(view.default, { home }));
      headers = {
        tours: headerAt("/tours"),
        tour: headerAt("/tours/tour", "default", "sh-slot-tour"),
        pages: Object.fromEntries(Object.values(SITE_PAGES).map((page) => [page.path, headerAt(page.path)]))
      };
    } finally {
      console.error = logError;
    }
    // The travel agency entry every page carries, from the site's own config (src/config/site.js).
    const site = await server.ssrLoadModule("/src/config/site.js");
    // /tours: the real tours page with its first page of results (from the API; without it only the header).
    const toursView = await server.ssrLoadModule("/src/components/tours/toursPage/ToursPage.jsx");
    const toursData = await server.ssrLoadModule("/src/components/tours/toursPage/toursPageData.js");
    let toursFirst = null;
    try {
      toursFirst = (await requestJson(`${apiUrl}/tours/search?limit=9`)).data || null;
    } catch (error) {
      console.warn(`Tours page data unavailable, /tours prerendered without results: ${error.message}`);
    }
    const quietRender = (path, element) => {
      const restore = console.error;
      console.error = (message, ...rest) => {
        if (!String(message).includes("useLayoutEffect does nothing on the server")) restore(message, ...rest);
      };
      try {
        return render(path, element);
      } finally {
        console.error = restore;
      }
    };
    const tours = toursFirst
      ? {
          html: headers.tours + quietRender("/tours", React.createElement(toursView.default, { initialData: toursFirst })),
          data: toursFirst,
          title: toursView.TOURS_TITLE,
          description: toursView.TOURS_DESCRIPTION,
          list: toursData.itemListSchema(toursFirst.items, siteUrl)
        }
      : null;
    return { html, headers, tours, agency: site.travelAgencySchema(null), schemas: view.homeSchemas(home), title: view.HOME_TITLE, description: view.HOME_DESCRIPTION, pages: Object.values(SITE_PAGES) };
  } finally {
    await server.close();
  }
};

const heroPreload = () =>
  '<link rel="preload" as="image" type="image/avif" href="/images/home/hero-dhow-1280.avif" imagesrcset="/images/home/hero-dhow-640.avif 640w, /images/home/hero-dhow-960.avif 960w, /images/home/hero-dhow-1280.avif 1280w" imagesizes="100vw" fetchpriority="high" />';

// An information page as plain HTML: title, intro and sections (a section is [heading, body] or { heading, body }).
const buildInfoMarkup = (page) => {
  const sections = page.sections.map((section) => (Array.isArray(section) ? { heading: section[0], body: section[1] } : section));
  return `<main><article><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.intro)}</p>${sections
    .map((section) => `<section><h2>${escapeHtml(section.heading)}</h2>${section.body ? `<p>${escapeHtml(section.body)}</p>` : ""}</section>`)
    .join("")}</article></main>`;
};

const getTour = async (slug) => (await requestJson(`${apiUrl}/tours/${encodeURIComponent(slug)}`)).data;

// Replacements are functions, so "$&" or "$1" in tour text is inserted as written.
const replaceHead = (html, metadata) => html
  .replace(/<title>[^<]*<\/title>/i, () => `<title>${escapeHtml(metadata.title)}</title>`)
  .replace(/<meta name="description" content="[^"]*" \/>/i, () => `<meta name="description" content="${escapeHtml(metadata.description)}" />`)
  .replace("</head>", () => `${metadata.head}\n  </head>`)
  .replace('<div id="root"></div>', () => `<div id="root">${metadata.body}</div>`);

const jsonLd = (entries) => `<script id="riser-prerender-schema" type="application/ld+json">${JSON.stringify(entries).replace(/</g, "\\u003c")}</script>`;

// agency: the TravelAgency entry (site-wide); the home page passes its own, which may carry a rating.
const sharedSchema = (agency = null) => ([
  { "@context": "https://schema.org", "@type": "Organization", "@id": `${siteUrl}/#organization`, name: brandName, url: siteUrl },
  { "@context": "https://schema.org", "@type": "WebSite", "@id": `${siteUrl}/#website`, name: brandName, url: siteUrl, publisher: { "@id": `${siteUrl}/#organization` } },
  ...(agency ? [agency] : [])
]);

// The tour itself, so the page renders at once instead of waiting for the API (it refreshes in the background).
// Internal and bulky fields are left out.
const pageData = (tour) => {
  const { rawBokunProduct, pickupPlaces, ...visible } = tour || {};
  return `<script id="riser-prerender-tour" type="application/json">${JSON.stringify(visible).replace(/</g, "\\u003c")}</script>`;
};

const metadata = ({ title, description, canonical, image = "", schemas, body, data = "" }) => ({
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
    jsonLd(schemas),
    data
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
  const details = await mapInBatches(tours, (tour) => getTour(tour.slug));
  const homeCanonical = `${siteUrl}/`;
  const homeData = await fetchHomeData();
  const home = await renderHome(homeData);
  await writePage(template, "/", metadata({
    title: home.title,
    description: home.description,
    canonical: homeCanonical,
    image: `${siteUrl}/images/home/hero-dhow-1280.jpg`,
    schemas: [...sharedSchema(), ...home.schemas],
    body: home.html,
    data: [
      heroPreload(),
      homeData ? `<script id="riser-prerender-home" type="application/json">${JSON.stringify(homeData).replace(/</g, "\\u003c")}</script>` : ""
    ].filter(Boolean).join("\n    ")
  }));
  await writePage(template, "/tours", metadata(home.tours
    ? {
        title: home.tours.title,
        description: home.tours.description,
        canonical: `${siteUrl}/tours`,
        schemas: [...sharedSchema(home.agency), home.tours.list],
        body: home.tours.html,
        data: `<script id="riser-prerender-tours" type="application/json">${JSON.stringify(home.tours.data).replace(/</g, "\\u003c")}</script>`
      }
    : {
        title: `Zanzibar Tours & Activities | ${brandName}`,
        description: "Compare Zanzibar tours and check live availability by date before booking.",
        canonical: `${siteUrl}/tours`,
        schemas: sharedSchema(home.agency),
        body: `${home.headers.tours}<main><h1>Zanzibar Tours & Activities</h1><p>Explore available Zanzibar experiences.</p><ul>${details.map((tour) => `<li><a href="/tours/${escapeHtml(tour.slug)}">${escapeHtml(tour.title)}</a></li>`).join("")}</ul></main>`
      }));
  for (const tour of details) {
    const canonical = `${siteUrl}/tours/${encodeURIComponent(tour.slug)}`;
    const description = truncate(tour.shortDescription || tour.description || `Explore ${tour.title} with ${brandName}.`);
    const image = String((tour.images || [])[0] || "");
    const schemas = [...sharedSchema(home.agency), {
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
      title: `${tour.title} | ${brandName}`, description, canonical, image, schemas, body: home.headers.tour + buildTourMarkup(tour), data: pageData(tour)
    }));
  }
  for (const page of home.pages) {
    await writePage(template, page.path, metadata({
      title: `${page.title} | ${brandName}`,
      description: truncate(page.description || page.intro),
      canonical: `${siteUrl}${page.path}`,
      schemas: sharedSchema(home.agency),
      body: (home.headers.pages[page.path] || "") + buildInfoMarkup(page)
    }));
  }
  const urls = [
    homeCanonical,
    `${siteUrl}/tours`,
    ...details.map((tour) => `${siteUrl}/tours/${encodeURIComponent(tour.slug)}`),
    ...home.pages.map((page) => `${siteUrl}${page.path}`)
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${escapeHtml(url)}</loc></url>`).join("\n")}\n</urlset>\n`;
  await fs.writeFile(path.join(dist, "sitemap.xml"), sitemap);
  console.log(JSON.stringify({ generatedPages: urls.length, generatedTourPages: details.length, sitemap: "dist/sitemap.xml" }));
};

run().catch((error) => {
  console.error(`SEO prerender failed: ${error.message}`);
  process.exitCode = 1;
});