import { useEffect } from "react";

const setMeta = (selector, attribute, value) => {
  if (!value) return;
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement("meta");
    document.head.appendChild(node);
  }
  node.setAttribute(attribute, value);
};

const SeoHead = ({ title, description, image = "", product = null }) => {
  useEffect(() => {
    const pageTitle = title || "Riser Tours & Safaris | Zanzibar Tours";
    const pageDescription = description || "Book Zanzibar tours, activities, and transfers with live availability and secure payment.";
    const canonicalUrl = window.location.href.split("#")[0];

    document.title = pageTitle;
    setMeta('meta[name="description"]', "name", "description");
    document.head.querySelector('meta[name="description"]')?.setAttribute("content", pageDescription);
    setMeta('meta[property="og:title"]', "property", "og:title");
    document.head.querySelector('meta[property="og:title"]')?.setAttribute("content", pageTitle);
    setMeta('meta[property="og:description"]', "property", "og:description");
    document.head.querySelector('meta[property="og:description"]')?.setAttribute("content", pageDescription);
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

    const existingSchema = document.getElementById("riser-product-schema");
    if (existingSchema) existingSchema.remove();
    if (product?.name) {
      const schema = document.createElement("script");
      schema.id = "riser-product-schema";
      schema.type = "application/ld+json";
      schema.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.name,
        description: product.description || pageDescription,
        image: product.image ? [product.image] : undefined,
        offers: Number(product.price || 0) > 0 ? {
          "@type": "Offer",
          price: Number(product.price),
          priceCurrency: product.currency || "USD",
          availability: "https://schema.org/InStock",
          url: canonicalUrl
        } : undefined
      });
      document.head.appendChild(schema);
    }

    return () => document.getElementById("riser-product-schema")?.remove();
  }, [description, image, product, title]);

  return null;
};

export default SeoHead;
