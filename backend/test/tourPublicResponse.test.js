process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/tour-public-response-test";
process.env.JWT_SECRET ||= "tour-public-response-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const toursService = require("../src/services/tours");
const toursController = require("../src/controllers/tours.controller");

test("public tour detail omits raw Bokun payload and retains required tour fields", async (context) => {
  const rawBokunProduct = { hugeRawPayload: "supplier-private-and-unneeded" };
  const tour = {
    slug: "sample-tour",
    title: "Sample Zanzibar tour",
    description: "Tour description",
    images: ["https://images.example/tour.jpg"],
    fromPrice: 25,
    currency: "USD",
    bokunProductId: "product-1",
    options: [{ bokunOptionId: "option-1" }],
    priceCatalogs: [{ catalogId: "catalog-1" }],
    pickupPlaces: [{ id: "pickup-1" }],
    rawBokunProduct
  };
  const originalRawPayload = tour.rawBokunProduct;
  context.mock.method(toursService, "getTourBySlug", async () => tour);

  let responseBody;
  let cacheControl;
  const res = {
    set(name, value) { if (name === "Cache-Control") cacheControl = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { responseBody = body; return this; }
  };

  await toursController.getTourBySlug({ params: { slug: "sample-tour" }, requestId: "test-request" }, res, (error) => {
    if (error) throw error;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(cacheControl, "public, max-age=60, stale-while-revalidate=300");
  assert.equal(Object.hasOwn(responseBody.data, "rawBokunProduct"), false);
  assert.deepEqual(responseBody.data, {
    slug: "sample-tour",
    title: "Sample Zanzibar tour",
    description: "Tour description",
    images: ["https://images.example/tour.jpg"],
    fromPrice: 25,
    currency: "USD",
    bokunProductId: "product-1",
    options: [{ bokunOptionId: "option-1" }],
    priceCatalogs: [{ catalogId: "catalog-1" }],
    pickupPlaces: [{ id: "pickup-1" }]
  });
  assert.equal(tour.rawBokunProduct, originalRawPayload);
});