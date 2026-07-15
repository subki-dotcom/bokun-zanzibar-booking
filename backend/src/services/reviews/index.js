const axios = require("axios");
const { env } = require("../../config/env");

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cachedReviews = null;
let cachedAt = 0;

const isConfigured = () => Boolean(env.GOOGLE_PLACES_API_KEY && env.GOOGLE_PLACE_ID);

const fetchGoogleReviews = async () => {
  if (!isConfigured()) {
    return { source: "google", configured: false, rating: null, reviewCount: 0, reviews: [], reviewUrl: env.GOOGLE_REVIEW_URL || "" };
  }

  if (cachedReviews && Date.now() - cachedAt < CACHE_TTL_MS) return cachedReviews;

  const response = await axios.get(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(env.GOOGLE_PLACE_ID)}`,
    {
      headers: {
        "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "displayName,rating,userRatingCount,reviews"
      },
      timeout: 15000
    }
  );
  const body = response.data || {};
  cachedReviews = {
    source: "google",
    configured: true,
    rating: Number(body.rating || 0),
    reviewCount: Number(body.userRatingCount || 0),
    reviewUrl: env.GOOGLE_REVIEW_URL || "",
    reviews: (body.reviews || []).map((review = {}) => ({
      name: review.authorAttribution?.displayName || "Google traveler",
      rating: Number(review.rating || 0),
      text: String(review.text?.text || "").trim(),
      published: review.relativePublishTimeDescription || "",
      source: "Google"
    })).filter((review) => review.text && review.rating > 0).slice(0, 3)
  };
  cachedAt = Date.now();
  return cachedReviews;
};

module.exports = { fetchGoogleReviews };
