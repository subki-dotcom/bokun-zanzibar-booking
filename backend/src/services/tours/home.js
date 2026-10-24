// Everything the home page shows, from the product snapshots and real bookings, kept for ten minutes. No supplier
// calls: prices are the stored "From" prices.
const ProductSnapshot = require("../../models/ProductSnapshot");
const Booking = require("../../models/Booking");
const logger = require("../../config/logger");
const { pickBestSellers, pickFeatured, pickMenuTour, pickTopTours, showable, styleTiles, toHomeCard } = require("./homeCatalog");

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

// The company's own Tripadvisor rating (the page several tours link to in Bókun), for "Guest reviews" on the home page.
const companyReviews = (rows = []) => {
  const company = rows
    .map((row) => row.tripadvisor)
    .filter((listing) => listing?.scope === "company" && listing.rating > 0 && listing.reviewCount > 0)
    .sort((a, b) => b.reviewCount - a.reviewCount)[0];
  return company ? { rating: company.rating, count: company.reviewCount, source: "Tripadvisor", url: company.url } : null;
};

const buildHomeData = async () => {
  const [rows, bookings] = await Promise.all([
    ProductSnapshot.find(PUBLIC_FILTER)
      .select("bokunProductId title slug shortDescription description duration images fromPrice currency rating reviewCount reviewSource tripadvisor included pickupInfo featuredOnHome featuredInMenu options.active options.pickupSupported options.pricingType")
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
  const reviews = companyReviews(rows);

  return {
    generatedAt: new Date().toISOString(),
    totalTours: rows.length,
    styles: styleTiles(cards.filter((card) => card.image)),
    featured: featured.tours,
    featuredSource: featured.source,
    bestSellers,
    // The header: the "Tours & activities" menu card and the search panel's top tours.
    menu: {
      featured: pickMenuTour(visible, bookings),
      top: pickTopTours(visible, bookings, 3)
    },
    safari: flagship
      ? {
          tour: flagship,
          fromPrice: flagship.fromPrice,
          currency: flagship.currency,
          count: safaris.length
        }
      : null,
    // Real reviews only; null hides the section.
    reviews
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
