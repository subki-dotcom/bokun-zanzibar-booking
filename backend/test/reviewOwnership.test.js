process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/review-test";
process.env.JWT_SECRET ||= "review-test-secret";
const test = require("node:test");
const assert = require("node:assert/strict");
const { withOwnReviews, isOwnListing } = require("../src/services/tours/reviewOwnership");

const OTHER = "https://www.tripadvisor.com/Attraction_Review-g8055401-d25068336-Reviews-Other_company-Zanzibar.html";
const OURS = "https://www.tripadvisor.com/Attraction_Review-g8055401-d11111111-Reviews-Zanzibar_Tours-Zanzibar.html";
const product = (url) => ({ title: "Mnemba", rating: 4.5, reviewCount: 20, reviewSource: "Tripadvisor", reviewUrl: url, tripadvisor: { scope: "company", url, rating: 4.5, reviewCount: 20 } });

test("without a listing id no Tripadvisor rating or link is shown", () => {
  const clean = withOwnReviews(product(OTHER));
  assert.equal(clean.tripadvisor, null);
  assert.deepEqual([clean.rating, clean.reviewCount, clean.reviewSource, clean.reviewUrl], [0, 0, "", ""]);
  assert.equal(clean.title, "Mnemba");
});

test("only the company's own listing is kept", () => {
  assert.ok(isOwnListing(OURS, "d11111111"));
  assert.ok(!isOwnListing(OTHER, "d11111111"));
  assert.equal(withOwnReviews(product(OURS), "d11111111").reviewCount, 20);
  assert.equal(withOwnReviews(product(OTHER), "d11111111").reviewCount, 0);
});

test("reviews collected by Bokun itself are not touched", () => {
  const own = { rating: 4.8, reviewCount: 7, reviewSource: "", reviewUrl: "", tripadvisor: null };
  assert.deepEqual(withOwnReviews(own), own);
});
