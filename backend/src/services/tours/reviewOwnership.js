// Tripadvisor reviews are shown only from this company's own Tripadvisor listing. Bókun can link products to
// another company's listing (its reviews are not ours to show); those ratings, counts and links are left out.
// TRIPADVISOR_LISTING_ID is the "d…" number in the company's Tripadvisor address (e.g. d12345678); without it no
// Tripadvisor review is shown. Reviews collected by Bókun itself (no Tripadvisor link) are not affected.
const { env } = require("../../config/env");

const listingId = () => String(env.TRIPADVISOR_LISTING_ID || "").trim().replace(/^-|-$/g, "");

const isOwnListing = (url = "", id = listingId()) => {
  return Boolean(id) && new RegExp(`-${id.replace(/[^A-Za-z0-9]/g, "")}-`, "i").test(String(url || ""));
};

// The product without another company's Tripadvisor rating (fields it does not have are left as they are).
const withOwnReviews = (product, id = listingId()) => {
  if (!product || typeof product !== "object") return product;
  const next = { ...product };
  if (next.tripadvisor && !isOwnListing(next.tripadvisor.url, id)) next.tripadvisor = null;
  if (/tripadvisor/i.test(String(next.reviewSource || "")) && !isOwnListing(next.reviewUrl, id)) {
    next.rating = 0;
    next.reviewCount = 0;
    next.reviewSource = "";
    next.reviewUrl = "";
  }
  return next;
};

module.exports = { isOwnListing, withOwnReviews };
