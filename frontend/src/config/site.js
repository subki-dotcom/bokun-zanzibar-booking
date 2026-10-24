// Everything the site says about the business, in one place: contacts, address, social links, travel styles
// and the footer links. Contacts and social links can also be set in the hosting environment (VITE_*); see brand.js.
import { BRAND } from "./brand";

export const SITE = {
  name: BRAND.name,
  website: BRAND.website,
  phone: BRAND.phone,
  phoneHref: BRAND.phoneHref,
  email: BRAND.email,
  address: { locality: "Zanzibar", country: "Tanzania", countryCode: "TZ" },
  tagline: "Handpicked tours, safaris and transfers in Zanzibar, booked with a local team.",
  description:
    "Handpicked tours, safaris and transfers in Zanzibar – from Stone Town and Mnemba to the Serengeti, booked with a local team.",
  whatsappHref: BRAND.whatsappHref,
  // The message a guest's WhatsApp opens with.
  whatsappMessage: `Hi ${BRAND.name}, I'd like help planning my Zanzibar trip. My dates and hotel are: `,
  // Only the networks with an address are shown.
  social: {
    instagram: BRAND.social.instagram,
    facebook: BRAND.social.facebook,
    tripadvisor: BRAND.social.tripadvisor,
    tiktok: BRAND.social.tiktok,
    youtube: BRAND.social.youtube
  }
};

export const whatsappLink = (message = SITE.whatsappMessage) =>
  SITE.whatsappHref ? `${SITE.whatsappHref}?text=${encodeURIComponent(message)}` : "";

// The travel styles the tours page filters by (?category=<key> or the label).
export const TRAVEL_STYLES = [
  { key: "sea", label: "Sea tours", nav: "Sea tours" },
  { key: "cultural", label: "Cultural tours", nav: "Cultural tours" },
  { key: "safari", label: "Safari trips", nav: "Safaris" },
  { key: "private", label: "Private tours", nav: "Private tours" },
  { key: "transfers", label: "Transfers", nav: "Transfers" }
];

// "cultural" or "Cultural tours" → "Cultural tours"; anything else is returned as given.
export const styleLabel = (value = "") => {
  const wanted = String(value).trim().toLowerCase();
  return TRAVEL_STYLES.find((style) => style.key === wanted || style.label.toLowerCase() === wanted)?.label || value;
};

// Footer columns. "search" links are shown only when that search finds at least one tour.
export const FOOTER_LINKS = {
  experiences: [
    { label: "Stone Town tours", to: "/tours?category=cultural&q=stone-town" },
    { label: "Mnemba Island", to: "/tours?q=mnemba" },
    { label: "Prison Island", to: "/tours?q=prison-island" },
    { label: "Jozani Forest", to: "/tours?q=jozani" },
    { label: "Safari Blue", to: "/tours?q=safari-blue", onlyIfFound: "safari-blue" },
    { label: "Safaris from Zanzibar", to: "/tours?category=safari" }
  ],
  company: [
    { label: "About us", to: "/about" },
    { label: "All tours", to: "/tours" },
    { label: "Airport transfers", to: "/tours?category=transfers" },
    { label: "Contact us", to: "/contact" },
    { label: "Agent login", to: "/login" }
  ],
  help: [
    { label: "My booking", to: "/my-booking" },
    { label: "Cancellation policy", to: "/cancellation-policy" },
    { label: "FAQ", to: "/faq" },
    { label: "Terms", to: "/terms" },
    { label: "Privacy", to: "/privacy" }
  ]
};

// The business as a travel agency, for search engines; a rating only when real reviews exist.
export const travelAgencySchema = (reviews = null) => {
  const sameAs = Object.values(SITE.social).filter(Boolean);
  return {
    "@context": "https://schema.org",
    "@type": "TravelAgency",
    "@id": `${SITE.website}/#travelagency`,
    name: SITE.name,
    url: `${SITE.website}/`,
    image: `${SITE.website}/images/home/hero-dhow-1280.jpg`,
    telephone: SITE.phone,
    email: SITE.email,
    address: { "@type": "PostalAddress", addressLocality: SITE.address.locality, addressCountry: SITE.address.countryCode },
    areaServed: ["Zanzibar", "Tanzania"],
    parentOrganization: { "@id": `${SITE.website}/#organization` },
    ...(sameAs.length ? { sameAs } : {}),
    ...(reviews?.count && reviews.rating
      ? { aggregateRating: { "@type": "AggregateRating", ratingValue: reviews.rating, reviewCount: reviews.count, bestRating: 5 } }
      : {})
  };
};
