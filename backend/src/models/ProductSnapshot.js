const mongoose = require("mongoose");

const optionSnapshotSchema = new mongoose.Schema(
  {
    bokunOptionId: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    language: { type: String, default: "" },
    pricingSummary: { type: String, default: "" },
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
    itinerary: [{ type: String }],
    meetingInfo: { type: String, default: "" },
    pickupInfo: { type: String, default: "" },
    included: [{ type: String }],
    excluded: [{ type: String }],
    importantInformation: [{ type: String }],
    highlights: [{ type: String }],
    categories: [{ type: String }],
    destination: { type: String, default: "Zanzibar" },
    status: { type: String, default: "active" },
    currency: { type: String, default: "USD" },
    fromPrice: { type: Number, default: 0 },
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    options: [optionSnapshotSchema],
    priceCatalogs: [priceCatalogSnapshotSchema],
    lastSyncedAt: { type: Date, default: Date.now },
    rawBokunProduct: { type: mongoose.Schema.Types.Mixed }
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProductSnapshot", productSnapshotSchema);
