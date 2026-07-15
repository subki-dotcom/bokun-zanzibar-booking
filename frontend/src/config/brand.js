const envValue = (key, fallback = "") => String(import.meta.env[key] || fallback).trim();

const normalizePhone = (phone = "") => String(phone).replace(/[^\d]/g, "");

const phone = envValue("VITE_SUPPORT_PHONE", "+255 778 775 044");
const whatsappNumber = normalizePhone(envValue("VITE_WHATSAPP_NUMBER", phone));

export const BRAND = {
  name: "Riser Tours & Safaris",
  location: "Zanzibar, Tanzania",
  phone,
  phoneHref: `tel:${phone.replace(/\s/g, "")}`,
  whatsappHref: whatsappNumber ? `https://wa.me/${whatsappNumber}` : "",
  email: envValue("VITE_SUPPORT_EMAIL", "info@risertoursandsafaris.co.tz"),
  social: {
    facebook: envValue("VITE_FACEBOOK_URL"),
    instagram: envValue("VITE_INSTAGRAM_URL"),
    tiktok: envValue("VITE_TIKTOK_URL"),
    youtube: envValue("VITE_YOUTUBE_URL")
  }
};

export const getConfiguredSocialLinks = () =>
  Object.entries(BRAND.social)
    .filter(([, href]) => Boolean(href))
    .map(([network, href]) => ({ network, href }));
