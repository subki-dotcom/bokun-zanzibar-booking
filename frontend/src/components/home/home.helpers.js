import { formatCurrency } from "../../utils/formatters";

const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1518544866330-95a67b1b5f39?auto=format&fit=crop&w=1200&q=80";

export const formatHomePrice = ({ fromPrice = 0, currency = "USD", pricingType = "per_person" } = {}) => {
  const safePrice = Number(fromPrice || 0);
  if (!Number.isFinite(safePrice) || safePrice <= 0) {
    return "Check live pricing";
  }

  const suffix = pricingType === "per_group" ? "/ group" : "/ person";
  return `From ${formatCurrency(safePrice, currency)} ${suffix}`;
};

export const normalizeTourCard = (tour = {}) => {
  const imageCandidate = Array.isArray(tour.images) ? tour.images[0] : tour.image;
  const image =
    typeof imageCandidate === "string"
      ? imageCandidate
      : imageCandidate?.url || imageCandidate?.thumbnailUrl || imageCandidate?.src || "";

  return {
    id: String(tour.id || tour.bokunProductId || ""),
    slug: String(tour.slug || ""),
    title: String(tour.title || "Zanzibar Experience"),
    shortDescription: String(tour.shortDescription || "Explore Zanzibar with a trusted local team.").slice(0, 160),
    duration: String(tour.durationText || tour.duration || "Flexible duration"),
    location: String(tour.locationText || tour.destination || "Zanzibar"),
    fromPrice: Number(tour.fromPrice || 0),
    rating: Number(tour.rating || 0),
    reviewCount: Number(tour.reviewCount || 0),
    currency: String(tour.currency || "USD"),
    pricingType: String(tour.pricingType || "per_person"),
    image: image || FALLBACK_IMAGE,
    categories: Array.isArray(tour.categories) ? tour.categories.filter(Boolean) : []
  };
};

export const pickFeaturedTours = (rows = [], limit = 6) => rows.slice(0, limit).map(normalizeTourCard);

export const pickBestSellerTours = (rows = [], limit = 8) =>
  [...rows]
    .sort((a, b) => {
      const byRating = Number(b.rating || 0) - Number(a.rating || 0);
      if (byRating !== 0) {
        return byRating;
      }

      const byReviews = Number(b.reviewCount || 0) - Number(a.reviewCount || 0);
      if (byReviews !== 0) {
        return byReviews;
      }

      return Number(a.fromPrice || 0) - Number(b.fromPrice || 0);
    })
    .slice(0, limit)
    .map(normalizeTourCard);

export const buildHeroSearchPayload = ({ category = "", date = "", travelers = 2 } = {}) => {
  const query = new URLSearchParams();
  if (category && category !== "all") {
    query.set("q", category);
  }
  query.set("page", "1");
  if (date) {
    query.set("travelDate", date);
  }
  query.set("travelers", String(Math.max(1, Number(travelers || 2))));
  return query.toString();
};

export const buildCategoryCards = (rows = []) => {
  const input = Array.isArray(rows) ? rows : [];
  if (input.length > 0) {
    return input.slice(0, 6).map((row) => ({
      name: String(row.name || "Category"),
      count: Number(row.count || 0)
    }));
  }

  return [
    { name: "Sea Tours", count: 0 },
    { name: "Safari Trips", count: 0 },
    { name: "Cultural Tours", count: 0 },
    { name: "Private Tours", count: 0 },
    { name: "Transfers", count: 0 }
  ];
};

export const homeFallbackTours = [
  {
    id: "mnemba",
    slug: "",
    title: "Mnemba Island Snorkeling Adventure",
    shortDescription: "Crystal-clear snorkeling, marine life encounters, and premium dhow comfort.",
    duration: "6 hours",
    location: "Zanzibar",
    fromPrice: 70,
    rating: 4.8,
    reviewCount: 124,
    currency: "USD",
    pricingType: "per_person",
    image: "https://images.unsplash.com/photo-1462536943532-57a629f6cc60?auto=format&fit=crop&w=1200&q=80",
    categories: ["Sea Tours"]
  },
  {
    id: "stone-town",
    slug: "",
    title: "Stone Town Heritage Walking Tour",
    shortDescription: "Explore history, architecture, and local culture with a professional guide.",
    duration: "4 hours",
    location: "Stone Town",
    fromPrice: 35,
    rating: 4.7,
    reviewCount: 96,
    currency: "USD",
    pricingType: "per_person",
    image: "https://images.unsplash.com/photo-1526157387212-93f3d8d50e20?auto=format&fit=crop&w=1200&q=80",
    categories: ["Cultural Tours"]
  },
  {
    id: "prison-island",
    slug: "",
    title: "Prison Island and Sandbank Experience",
    shortDescription: "Historic island visit and tropical beach relaxation in one memorable trip.",
    duration: "6 hours",
    location: "Zanzibar",
    fromPrice: 65,
    rating: 4.9,
    reviewCount: 141,
    currency: "USD",
    pricingType: "per_person",
    image: "https://images.unsplash.com/photo-1558981403-c5f9891f5fbf?auto=format&fit=crop&w=1200&q=80",
    categories: ["Sea Tours"]
  }
];
