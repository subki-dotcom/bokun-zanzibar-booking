// Pure helpers for the home page (mockup "HomePro"): style links, the search query and price text.

// The travel styles in the header, search and tiles; "category" is the value /tours filters by.
export const HOME_STYLES = [
  { key: "sea", label: "Sea tours", nav: "Sea tours" },
  { key: "cultural", label: "Cultural tours", nav: "Cultural tours" },
  { key: "safari", label: "Safari trips", nav: "Safaris" },
  { key: "private", label: "Private tours", nav: "Private tours" },
  { key: "transfers", label: "Transfers", nav: "Transfers" }
];

export const styleHref = (label = "") => (label ? `/tours?category=${encodeURIComponent(label)}` : "/tours");

// /tours with the chosen style, date and travellers (the parameters the tours page reads).
export const searchHref = ({ category = "", date = "", travelers = 2 } = {}) => {
  const query = new URLSearchParams();
  if (category) query.set("category", category);
  if (date) query.set("travelDate", date);
  query.set("travelers", String(Math.max(1, Math.min(20, Number(travelers) || 2))));
  return `/tours?${query.toString()}`;
};

export const money = (amount = 0, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: Number(amount) % 1 ? 2 : 0,
    maximumFractionDigits: 2
  }).format(Number(amount || 0));

// "Sat, 31 Oct" for the date field.
export const shortDate = (iso = "") => {
  const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(date).replace(/^(\w+)\s/, "$1, ");
};

export const todayIso = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

export const travelersText = (count = 2) => `${count} traveler${Number(count) === 1 ? "" : "s"}`;

export const whatsappPlanHref = (baseHref = "", brand = "") =>
  baseHref ? `${baseHref}?text=${encodeURIComponent(`Hi ${brand || "there"}, I'd like help planning my Zanzibar trip. My dates and hotel are: `)}` : "";
