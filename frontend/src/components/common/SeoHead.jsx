import { useEffect } from "react";
import { BRAND } from "../../config/brand";

const setMeta = (selector, attribute, value) => {
  if (!value) return;
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement("meta");
    document.head.appendChild(node);
  }
  node.setAttribute(attribute, value);
};

const SeoHead = ({ title, description, image = "", product = null, noIndex = false }) => {
  useEffect(() => {
    const pageTitle = title || "Riser Tours & Safaris | Zanzibar Tours";
    const pageDescription = description || "Book Zanzibar tours, activities, and transfers with live availability and secure payment.";
    const canonicalUrl = `${BRAND.website}${window.location.pathname}`;

    document.title = pageTitle;
    setMeta('meta[name="description"]', "name", "description");
    document.head.querySelector('meta[name="description"]')?.setAttribute("content", pageDescription);
    setMeta('meta[property="og:title"]', "property", "og:title");
    document.head.querySelector('meta[property="og:title"]')?.setAttribute("content", pageTitle);
    setMeta('meta[property="og:description"]', "property", "og:description");
    document.head.querySelector('meta[property="og:description"]')?.setAttribute("content", pageDescription);
    setMeta('meta[property="og:type"]', "property", "og:type");
    document.head.querySelector('meta[property="og:type"]')?.setAttribute("content", product?.name ? "product" : "website");
    setMeta('meta[property="og:url"]', "property", "og:url");
    document.head.querySelector('meta[property="og:url"]')?.setAttribute("content", canonicalUrl);
    setMeta('meta[name="twitter:card"]', "name", "twitter:card");
    document.head.querySelector('meta[name="twitter:card"]')?.setAttribute("content", image ? "summary_large_image" : "summary");
    setMeta('meta[name="twitter:title"]', "name", "twitter:title");
    document.head.querySelector('meta[name="twitter:title"]')?.setAttribute("content", pageTitle);
    setMeta('meta[name="twitter:description"]', "name", "twitter:description");
    document.head.querySelector('meta[name="twitter:description"]')?.setAttribute("content", pageDescription);
    if (image) {
      setMeta('meta[property="og:image"]', "property", "og:image");
      document.head.querySelector('meta[property="og:image"]')?.setAttribute("content", image);
    }

    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", canonicalUrl);

    setMeta('meta[name="robots"]', "name", "robots");
    document.head.querySelector('meta[name="robots"]')?.setAttribute("content", noIndex ? "noindex, nofollow" : "index, follow");

    const existingSchema = document.getElementById("riser-seo-schema");
    if (existingSchema) existingSchema.remove();
    const schemas = [
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        "@id": `${BRAND.website}/#organization`,
        name: BRAND.name,
        url: BRAND.website,
        email: BRAND.email,
        telephone: BRAND.phone
      },
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": `${BRAND.website}/#website`,
        name: BRAND.name,
        url: BRAND.website,
        publisher: { "@id": `${BRAND.website}/#organization` }
      }
    ];
    if (product?.name) {
      schemas.push({
        "@context": "https://schema.org",
        "@type": "TouristTrip",
        "@id": `${canonicalUrl}#tour`,
        url: canonicalUrl,
        name: product.name,
        description: product.description || pageDescription,
        image: product.image ? [product.image] : undefined
      });
      schemas.push({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${BRAND.website}/` },
          { "@type": "ListItem", position: 2, name: "Tours", item: `${BRAND.website}/tours` },
          { "@type": "ListItem", position: 3, name: product.name, item: canonicalUrl }
        ]
      });
    }
    const schema = document.createElement("script");
    schema.id = "riser-seo-schema";
    schema.type = "application/ld+json";
    schema.textContent = JSON.stringify(schemas);
    document.head.appendChild(schema);

    return () => document.getElementById("riser-seo-schema")?.remove();
  }, [description, image, noIndex, product, title]);

  return null;
};

export default SeoHead;
