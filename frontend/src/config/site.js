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
  // The message a guest's WhatsApp opens with (footer and contact page; the header uses whatsappHelloMessage).
  whatsappMessage: `Hi ${BRAND.name}, I'd like help planning my Zanzibar trip. My dates and hotel are: `,
  whatsappHelloMessage: "Hello, I'd like help planning a Zanzibar trip",
  // Shown on the contact page. Placeholder: replace with your real hours.
  openingHours: "Every day, 8:00 – 20:00 (East Africa Time)",
  // Prices are in US dollars only; a currency menu appears when more currencies are offered.
  currencies: ["USD"],
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

// The header's main navigation, in this order (activeNavKey in the header decides the current page).
export const MAIN_NAV = [
  { key: "home", label: "Home", to: "/" },
  { key: "tours", label: "Tours & activities", to: "/tours", menu: true },
  { key: "transfers", label: "Transfers", to: "/tours?category=transfers" },
  { key: "safaris", label: "Safaris", to: "/tours?category=safari" },
  { key: "contact", label: "Contact", to: "/contact" },
  { key: "booking", label: "My booking", to: "/my-booking" }
];

// "Tours & activities" menu. A link with "search" is hidden when that search finds no tour (and, while the menu's
// data loads, when it is marked hideUntilFound); "price" adds the lowest real price of the search.
export const MEGA_MENU = [
  {
    key: "sea",
    title: "Sea tours",
    links: [
      { label: "Mnemba Island snorkeling", search: "mnemba" },
      { label: "Nakupenda Sandbank", search: "nakupenda" },
      { label: "Prison Island", search: "prison-island" },
      { label: "Safari Blue", search: "safari-blue", hideUntilFound: true },
      { label: "Dolphins & Salaam Cave", search: "dolphin" }
    ],
    all: { label: "All sea tours", to: "/tours?category=sea" }
  },
  {
    key: "culture",
    title: "Culture & nature",
    links: [
      { label: "Stone Town walking tour", search: "stone-town", to: "/tours?category=cultural&q=stone-town" },
      { label: "Spice farm tours", search: "spice" },
      { label: "Jozani Forest", search: "jozani" },
      { label: "The Rock Restaurant", search: "the-rock" }
    ],
    all: { label: "All cultural tours", to: "/tours?category=cultural" }
  },
  {
    key: "safaris",
    title: "Safaris",
    links: [
      { label: "Serengeti, Ngorongoro & Tarangire (4 days)", search: "serengeti" },
      { label: "Fly-in safaris from Zanzibar", search: "flight", to: "/tours?category=safari" }
    ],
    all: { label: "All safaris", to: "/tours?category=safari" }
  },
  {
    key: "transfers",
    title: "Transfers",
    links: [
      { label: "Airport to hotel", search: "airport", price: true },
      { label: "Ferry port to hotel", search: "ferry", price: true },
      { label: "Private tours by car", to: "/tours?category=private" }
    ],
    all: { label: "All transfers", to: "/tours?category=transfers" }
  }
];

// Phones: the short list under "Tours & activities".
export const MOBILE_TOUR_LINKS = [
  { label: "Sea tours", to: "/tours?category=sea" },
  { label: "Culture & nature", to: "/tours?category=cultural" },
  { label: "Private tours", to: "/tours?category=private" }
];

export const POPULAR_SEARCHES = [
  { label: "Mnemba", query: "mnemba" },
  { label: "Stone Town", query: "stone town" },
  { label: "Prison Island", query: "prison island" },
  { label: "Jozani", query: "jozani" },
  { label: "Safari", query: "safari" },
  { label: "Airport transfer", query: "airport" }
];

export const menuLinkHref = (link) => link.to || `/tours?q=${encodeURIComponent(link.search)}`;

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
