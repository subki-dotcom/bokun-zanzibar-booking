const mongoose = require("mongoose");
const {
  CRM_LEAD_SOURCE,
  CUSTOMER_DUPLICATE_STATUS,
  CUSTOMER_LIFECYCLE_STAGE,
  CUSTOMER_SEGMENT
} = require("../crm/constants");

const actorSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },
    role: { type: String, default: "" },
    email: { type: String, default: "" }
  },
  { _id: false }
);

const externalReferenceSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, trim: true },
    reference: { type: String, required: true, trim: true },
    rawReference: { type: String, default: "", trim: true },
    linkedAt: { type: Date, default: Date.now },
    metadata: mongoose.Schema.Types.Mixed
  },
  { _id: false }
);

const customerSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    emailNormalized: { type: String, default: "", lowercase: true, trim: true, index: true },
    phone: { type: String, default: "" },
    phoneNormalized: { type: String, default: "", trim: true, index: true },
    whatsappNumber: { type: String, default: "", trim: true },
    whatsappNormalized: { type: String, default: "", trim: true, index: true },
    country: { type: String, default: "" },
    hotelName: { type: String, default: "" },
    pickupPlaceId: { type: String, default: "" },
    notes: { type: String, default: "" },
    crmCustomerNumber: { type: String, default: "", uppercase: true, trim: true },
    lifecycleStage: {
      type: String,
      enum: Object.values(CUSTOMER_LIFECYCLE_STAGE),
      default: CUSTOMER_LIFECYCLE_STAGE.PROSPECT,
      index: true
    },
    segments: {
      type: [String],
      enum: Object.values(CUSTOMER_SEGMENT),
      default: []
    },
    manualSegments: {
      type: [String],
      enum: Object.values(CUSTOMER_SEGMENT),
      default: []
    },
    tags: { type: [String], default: [] },
    tagsNormalized: { type: [String], default: [] },
    source: {
      type: String,
      enum: Object.values(CRM_LEAD_SOURCE),
      default: CRM_LEAD_SOURCE.WEBSITE,
      index: true
    },
    sourceDetails: { type: String, default: "", trim: true },
    preferredContactChannel: {
      type: String,
      enum: ["", "EMAIL", "PHONE", "WHATSAPP"],
      default: ""
    },
    externalReferences: { type: [externalReferenceSchema], default: [] },
    deduplicationStatus: {
      type: String,
      enum: Object.values(CUSTOMER_DUPLICATE_STATUS),
      default: CUSTOMER_DUPLICATE_STATUS.CLEAN,
      index: true
    },
    possibleDuplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null, index: true },
    possibleDuplicateReasons: { type: [String], default: [] },
    lastCrmActivityAt: { type: Date, default: null, index: true },
    createdBy: { type: actorSnapshotSchema, default: () => ({}) },
    updatedBy: { type: actorSnapshotSchema, default: () => ({}) },
    dataQuality: {
      hasEmail: { type: Boolean, default: true },
      hasPhone: { type: Boolean, default: false },
      hasWhatsApp: { type: Boolean, default: false },
      reviewedAt: { type: Date, default: null },
      reviewNote: { type: String, default: "" }
    },
    bookings: [{ type: mongoose.Schema.Types.ObjectId, ref: "Booking" }]
  },
  { timestamps: true }
);

const normalizeEmail = (value = "") => String(value || "").trim().toLowerCase();
const normalizePhone = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "";
  const prefix = text.startsWith("+") ? "+" : "";
  const digits = text.replace(/[^\d]/g, "");
  return digits ? `${prefix}${digits}` : "";
};
const normalizeToken = (value = "") => String(value || "").trim();
const normalizeTag = (value = "") => normalizeToken(value).toLowerCase();
const dedupeTags = (tags = []) => {
  const seen = new Set();
  return (tags || []).map(normalizeToken).filter((tag) => {
    const normalized = normalizeTag(tag);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

customerSchema.pre("validate", function customerPreValidate(next) {
  this.fullName = `${this.firstName} ${this.lastName}`.trim();
  this.emailNormalized = normalizeEmail(this.email);
  this.phoneNormalized = normalizePhone(this.phone);
  this.whatsappNormalized = normalizePhone(this.whatsappNumber);
  this.tags = dedupeTags(this.tags || []);
  this.tagsNormalized = [...new Set(this.tags.map(normalizeTag).filter(Boolean))];
  this.segments = [...new Set(this.segments || [])];
  this.manualSegments = [...new Set(this.manualSegments || [])];
  this.externalReferences = (this.externalReferences || [])
    .map((reference) => ({
      ...reference,
      provider: normalizeToken(reference.provider).toLowerCase(),
      reference: normalizeToken(reference.reference),
      rawReference: normalizeToken(reference.rawReference || reference.reference)
    }))
    .filter((reference) => reference.provider && reference.reference);
  this.dataQuality = {
    ...(this.dataQuality || {}),
    hasEmail: Boolean(this.emailNormalized),
    hasPhone: Boolean(this.phoneNormalized),
    hasWhatsApp: Boolean(this.whatsappNormalized)
  };
  next();
});

customerSchema.index(
  { crmCustomerNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { crmCustomerNumber: { $type: "string", $gt: "" } }
  }
);
customerSchema.index({ phoneNormalized: 1, emailNormalized: 1 });
customerSchema.index({ whatsappNormalized: 1, emailNormalized: 1 });
customerSchema.index({ "externalReferences.provider": 1, "externalReferences.reference": 1 });
customerSchema.index({ lifecycleStage: 1, updatedAt: -1 });
customerSchema.index({ segments: 1, updatedAt: -1 });
customerSchema.index({ tagsNormalized: 1, updatedAt: -1 });

module.exports = mongoose.model("Customer", customerSchema);
