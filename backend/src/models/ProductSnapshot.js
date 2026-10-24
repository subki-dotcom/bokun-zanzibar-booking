const mongoose = require("mongoose");

const optionSnapshotSchema = new mongoose.Schema(
  {
    bokunOptionId: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    language: { type: String, default: "" },
    pricingSummary: { type: String, default: "" },
    pricingType: { type: String, default: "" },
    maxPerBooking: { type: Number, default: null },
    pickupSupported: { type: Boolean, default: false },
    meetingPointSupported: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    itinerary: [{ type: String }],
    importantInformation: [{ type: String }]
  },
  { _id: false }
);

const priceCatalogSnapshotSchema = new mongoose.Schema(
  {
    activityPriceCatalogId: { type: String, default: "" },
    catalogId: { type: String, default: "" },
    title: { type: String, default: "Default" },
    active: { type: Boolean, default: true },
    isVendorDefault: { type: Boolean, default: false },
    currency: { type: String, default: "" },
    validFrom: { type: String, default: null },
    validTo: { type: String, default: null }
  },
  { _id: false }
);

const liveTourGuideSnapshotSchema = new mongoose.Schema(
  {
    supported: { type: Boolean, default: false },
    guidanceType: { type: String, default: "" },
    languages: [{ type: String }]
  },
  { _id: false }
);

const itineraryItemSnapshotSchema = new mongoose.Schema(
  {
    bokunItineraryItemId: { type: String, default: "" },
    day: { type: Number, default: 0 },
    index: { type: Number, default: 0 },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    image: { type: String, default: "" },
    imageAlt: { type: String, default: "" },
    location: { type: String, default: "" },
    duration: { type: String, default: "" },
    admission: { type: String, default: "" }
  },
  { _id: false }
);

const pickupPlaceSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },
    title: { type: String, required: true },
    groupTitle: { type: String, default: "" },
    address: { type: String, default: "" },
    latitude: { type: mongoose.Schema.Types.Mixed, default: null },
    longitude: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { _id: false }
);

const productSnapshotSchema = new mongoose.Schema(
  {
    bokunProductId: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    description: { type: String, default: "" },
    shortDescription: { type: String, default: "" },
    duration: { type: String, default: "" },
    experienceType: { type: String, default: "" },
    difficulty: { type: String, default: "" },
    liveTourGuide: { type: liveTourGuideSnapshotSchema, default: () => ({}) },
    images: [{ type: String }],
    videoUrl: { type: String, default: "" },
    itinerary: [{ type: String }],
    itineraryItems: [itineraryItemSnapshotSchema],
    meetingInfo: { type: String, default: "" },
    pickupInfo: { type: String, default: "" },
    pickupPlaces: [pickupPlaceSnapshotSchema],
    included: [{ type: String }],
    excluded: [{ type: String }],
    importantInformation: [{ type: String }],
    highlights: [{ type: String }],
    categories: [{ type: String }],
    languages: [{ type: String }],
    groupSize: { type: String, default: "" },
    cancellationPolicy: { type: String, default: "" },
    bestSeller: { type: Boolean, default: false },
    destination: { type: String, default: "Zanzibar" },
    status: { type: String, default: "active" },
    currency: { type: String, default: "USD" },
    // One-adult starting price shown as "From"; basis and check time tell when it must be computed again.
    fromPrice: { type: Number, default: 0 },
    fromPriceBasis: { type: String, default: "" },
    fromPriceCheckedAt: { type: Date, default: null },
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    options: [optionSnapshotSchema],
    priceCatalogs: [priceCatalogSnapshotSchema],
    lastSyncedAt: { type: Date, default: Date.now },
    // Staff can hide a product (for example a duplicate) from listings, "You may also like" and the sitemap; its
    // page stays reachable by link so existing ads and bookings keep working. Bókun sync never changes this.
    hiddenFromPublic: { type: Boolean, default: false },
    // Chosen by staff for "Handpicked Zanzibar experiences" on the home page.
    featuredOnHome: { type: Boolean, default: false },
    hiddenAt: { type: Date, default: null },
    hiddenBy: { type: String, default: "" },
    rawBokunProduct: { type: mongoose.Schema.Types.Mixed }
  },
  { timestamps: true }
);

productSnapshotSchema.index({ status: 1, updatedAt: -1 });
productSnapshotSchema.index({ status: 1, categories: 1 });

module.exports = mongoose.model("ProductSnapshot", productSnapshotSchema);
