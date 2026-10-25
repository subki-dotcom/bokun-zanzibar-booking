// The tours page's filters live in the address (?category=sea&duration=half-day&price=20-300&sort=price_asc&q=mnemba
// &date=2026-11-10&pax=2&page=2), so results can be shared and Back works. Pure helpers to read and write them.
import { TRAVEL_STYLES } from "../../../config/site";

export const PAGE_SIZE = 9;

export const SORT_OPTIONS = [
  { key: "recommended", label: "Recommended" },
  { key: "price_asc", label: "Price: low to high" },
  { key: "price_desc", label: "Price: high to low" },
  { key: "duration_asc", label: "Duration: short to long" },
  { key: "duration_desc", label: "Duration: long to short" },
  { key: "title_asc", label: "Title A–Z" }
];
// The sort pills; the rest sit under "More".
export const MAIN_SORTS = ["recommended", "price_asc", "price_desc"];

// "sea", "Sea tours" or "sea tours" → "sea".
export const styleKey = (value = "") => {
  const wanted = String(value).trim().toLowerCase();
  return TRAVEL_STYLES.find((style) => style.key === wanted || style.label.toLowerCase() === wanted)?.key || "";
};

const list = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The address → filters. Older links (?travelDate=…&travelers=…, ?category=Sea%20tours) still work.
export const readFilters = (params) => {
  const get = (key) => params.get(key) || "";
  const [min, max] = get("price").split("-").map((value) => Number(value));
  const date = get("date") || get("travelDate");
  const pax = Number.parseInt(get("pax") || get("travelers"), 10);
  const page = Number.parseInt(get("page"), 10);
  return {
    category: styleKey(get("category")),
    q: get("q").slice(0, 80),
    duration: list(get("duration")),
    time: list(get("time")),
    good: list(get("good")),
    priceMin: Number.isFinite(min) && min > 0 ? min : 0,
    priceMax: Number.isFinite(max) && max > 0 ? max : 0,
    sort: SORT_OPTIONS.some((option) => option.key === get("sort")) ? get("sort") : "recommended",
    date: DATE.test(date) ? date : "",
    pax: Number.isFinite(pax) ? Math.max(1, Math.min(20, pax)) : 2,
    page: Number.isFinite(page) ? Math.max(1, Math.min(50, page)) : 1
  };
};

// Filters → the address (defaults are left out, so a plain /tours stays plain).
export const writeFilters = (filters) => {
  const params = new URLSearchParams();
  if (filters.category) params.set("category", filters.category);
  if (filters.q) params.set("q", filters.q);
  if (filters.duration.length) params.set("duration", filters.duration.join(","));
  if (filters.priceMin || filters.priceMax) params.set("price", `${filters.priceMin || 0}-${filters.priceMax || ""}`.replace(/-$/, "-"));
  if (filters.time.length) params.set("time", filters.time.join(","));
  if (filters.good.length) params.set("good", filters.good.join(","));
  if (filters.sort !== "recommended") params.set("sort", filters.sort);
  if (filters.date) params.set("date", filters.date);
  if (filters.pax !== 2) params.set("pax", String(filters.pax));
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
};

// What the server filters (the date is checked against live availability in the browser).
export const apiQuery = (filters, { page = 1, limit = PAGE_SIZE } = {}) => {
  const query = { page: String(page), limit: String(limit) };
  ["category", "q"].forEach((key) => {
    if (filters[key]) query[key] = filters[key];
  });
  if (filters.sort !== "recommended") query.sort = filters.sort;
  ["duration", "time", "good"].forEach((key) => {
    if (filters[key].length) query[key] = filters[key].join(",");
  });
  if (filters.priceMin || filters.priceMax) query.price = `${filters.priceMin || 0}-${filters.priceMax || ""}`;
  return query;
};

// The filters counted on the phone "Filters" button (category and search have their own controls).
export const activeFilterCount = (filters) =>
  filters.duration.length + filters.time.length + filters.good.length + (filters.priceMin || filters.priceMax ? 1 : 0);

// Everything except the page: a change here starts the results again.
export const resultsKey = (filters) => JSON.stringify({ ...filters, page: undefined });

export const sortLabel = (key) => SORT_OPTIONS.find((option) => option.key === key)?.label || "Recommended";
