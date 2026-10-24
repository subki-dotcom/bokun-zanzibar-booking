// Everything the home page shows, from the product snapshots and real bookings, kept for ten minutes. No supplier
// calls: prices are the stored "From" prices.
const ProductSnapshot = require("../../models/ProductSnapshot");
const Booking = require("../../models/Booking");
const logger = require("../../config/logger");
const { pickBestSellers, pickFeatured, showable, styleTiles, toHomeCard } = require("./homeCatalog");

const HOME_CACHE_TTL_MS = 10 * 60 * 1000;
const PUBLIC_FILTER = { status: "active", hiddenFromPublic: { $ne: true } };
let cached = null;
let inFlight = null;

// Bookings per product over the last year (cancelled and failed ones do not count).
const bookingCounts = async () => {
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const rows = await Booking.aggregate([
    { $match: { createdAt: { $gte: since }, bookingStatus: { $nin: ["cancelled", "failed"] } } },
    { $group: { _id: "$bokunProductId", count: { $sum: 1 } } }
  ]).catch((error) => {
    logger.warn("Home best sellers: booking counts skipped", { error: error.message });
    return [];
  });
  return new Map(rows.map((row) => [String(row._id || ""), Number(row.count || 0)]));
};

const buildHomeData = async () => {
  const [rows, bookings] = await Promise.all([
    ProductSnapshot.find(PUBLIC_FILTER)
      .select("bokunProductId title slug shortDescription description duration images fromPrice currency rating reviewCount included pickupInfo featuredOnHome options.active options.pickupSupported options.pricingType")
      .lean(),
    bookingCounts()
  ]);
  const cards = rows.map(toHomeCard);
  const visible = showable(cards, bookings);
  const featured = pickFeatured(visible, bookings, 6);
  const bestSellers = pickBestSellers(visible, bookings, featured.tours, 4);
  // The banner describes the flagship (fly-in, multi-day) safari, with that trip's own "From" price.
  const safaris = visible.filter((card) => card.styles.includes("safari")).sort((a, b) => b.fromPrice - a.fromPrice);
  const flagship = safaris[0] || null;
  const reviewed = rows.filter((row) => Number(row.reviewCount) > 0 && Number(row.rating) > 0);
  const reviewTotal = reviewed.reduce((sum, row) => sum + Number(row.reviewCount), 0);

  return {
    generatedAt: new Date().toISOString(),
    totalTours: rows.length,
    styles: styleTiles(cards.filter((card) => card.image)),
    featured: featured.tours,
    featuredSource: featured.source,
    bestSellers,
    safari: flagship
      ? {
          tour: flagship,
          fromPrice: flagship.fromPrice,
          currency: flagship.currency,
          count: safaris.length
        }
      : null,
    // Real reviews only; null hides the section and the rating schema.
    reviews: reviewTotal
      ? {
          rating: Number((reviewed.reduce((sum, row) => sum + Number(row.rating) * Number(row.reviewCount), 0) / reviewTotal).toFixed(1)),
          count: reviewTotal
        }
      : null
  };
};

const getHomeData = async () => {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (inFlight) return inFlight;
  inFlight = buildHomeData()
    .then((value) => {
      cached = { value, expiresAt: Date.now() + HOME_CACHE_TTL_MS };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
};

const forgetHomeData = () => {
  cached = null;
};

module.exports = { getHomeData, forgetHomeData };
