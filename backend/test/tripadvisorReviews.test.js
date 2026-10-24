const test = require("node:test");
const assert = require("node:assert/strict");
const { mapProduct } = require("../src/integrations/bokun/bokun.mapper");

const product = (tripadvisorReview, extra = {}) => ({ id: 1124157, title: "Full-Day Zanzibar Dolphins", reviewRating: 0, reviewCount: 0, tripadvisorReview, ...extra });

test("a tour's own Tripadvisor page gives its rating, count and where to read the reviews", () => {
  const mapped = mapProduct(product({
    url: "https://www.tripadvisor.co.uk/AttractionProductReview-g656265-d34058506-Full_Day_Zanzibar_Dolphins.html",
    rating: 4.7,
    numReviews: 18
  }));
  assert.equal(mapped.rating, 4.7);
  assert.equal(mapped.reviewCount, 18);
  assert.equal(mapped.reviewSource, "Tripadvisor");
  assert.match(mapped.reviewUrl, /AttractionProductReview/);
  assert.equal(mapped.tripadvisor.scope, "product");
});

test("the company's Tripadvisor page is kept for the home page but is not the tour's rating", () => {
  const mapped = mapProduct(product({
    url: "https://www.tripadvisor.com/Attraction_Review-g8055401-d25068336-Reviews-Riser_tours_and_safaris_Zanzibar.html",
    rating: 4.5,
    numReviews: 19
  }));
  assert.equal(mapped.rating, 0);
  assert.equal(mapped.reviewCount, 0);
  assert.equal(mapped.reviewSource, "");
  assert.deepEqual(mapped.tripadvisor, {
    url: "https://www.tripadvisor.com/Attraction_Review-g8055401-d25068336-Reviews-Riser_tours_and_safaris_Zanzibar.html",
    rating: 4.5,
    reviewCount: 19,
    scope: "company"
  });
});

test("a listing without reviews, or no listing, gives no rating", () => {
  assert.equal(mapProduct(product({ url: "https://www.tripadvisor.com/AttractionProductReview-x.html", rating: 0, numReviews: 1 })).tripadvisor, null);
  const none = mapProduct(product(undefined));
  assert.equal(none.tripadvisor, null);
  assert.equal(none.rating, 0);
});
