// The brand of this website: Zanzibar Tours & Safaris. The one place for the name, legal details and contacts
// (header, footer, titles, structured data, checkout, invoices). Each value can be overridden in the hosting
// environment (VITE_*); an empty contact or social link is simply not shown.
// import.meta.env exists in the Vite build; Node (tests, build scripts) reads the defaults below.
const ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};
const envValue = (key, fallback = "") => String(ENV[key] ?? fallback).trim();

const normalizePhone = (phone = "") => String(phone).replace(/[^\d]/g, "");

const phone = envValue("VITE_SUPPORT_PHONE", "+255 740 853 030");
const whatsappNumber = normalizePhone(envValue("VITE_WHATSAPP_NUMBER", phone));

export const BRAND = {
  name: envValue("VITE_BRAND_NAME", "Zanzibar Tours & Safaris"),
  legalName: envValue("VITE_LEGAL_NAME", "Zanzibar Tours and Safaris"),
  // The two lines of the wordmark (logo.svg), also used where the full name does not fit.
  wordmark: { top: "Zanzibar", bottom: "Tours & Safaris" },
  shortTagline: "Zanzibar · Tanzania",
  // Start of downloaded file names: "ZanzibarTours-Invoice-INV-2026-00001.pdf".
  filePrefix: "ZanzibarTours",
  website: envValue("VITE_SITE_URL", "https://zanzibartoursandsafaris.co.tz").replace(/\/$/, ""),
  location: "Zanzibar, Tanzania",
  streetAddress: envValue("VITE_STREET_ADDRESS", "Stone Town"),
  taxId: envValue("VITE_TAX_ID", "157-694-596"),
  licence: envValue("VITE_LICENCE"),
  phone,
  phoneHref: phone ? `tel:${phone.replace(/\s/g, "")}` : "",
  whatsappHref: whatsappNumber ? `https://wa.me/${whatsappNumber}` : "",
  email: envValue("VITE_SUPPORT_EMAIL", "info@zanzibartoursandsafaris.co.tz"),
  bookingsEmail: envValue("VITE_BOOKINGS_EMAIL", "info@zanzibartoursandsafaris.co.tz"),
  // Brand files in /public.
  logo: "/brand/logo.svg",
  logoWhite: "/brand/logo-white.svg",
  icon: "/brand/icon.svg",
  social: {
    facebook: envValue("VITE_FACEBOOK_URL"),
    instagram: envValue("VITE_INSTAGRAM_URL"),
    tiktok: envValue("VITE_TIKTOK_URL"),
    youtube: envValue("VITE_YOUTUBE_URL"),
    tripadvisor: envValue("VITE_TRIPADVISOR_URL")
  }
};

export const getConfiguredSocialLinks = () =>
  Object.entries(BRAND.social)
    .filter(([, href]) => Boolean(href))
    .map(([network, href]) => ({ network, href }));
