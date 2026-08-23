const mongoose = require("mongoose");
const {
  CRM_LEAD_SOURCE,
  CRM_LEAD_STATUS
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

const leadSchema = new mongoose.Schema(
  {
    leadReference: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, default: "", lowercase: true, trim: true, index: true },
    emailNormalized: { type: String, default: "", lowercase: true, trim: true, index: true },
    phone: { type: String, default: "", trim: true },
    phoneNormalized: { type: String, default: "", trim: true, index: true },
    whatsappNumber: { type: String, default: "", trim: true },
    whatsappNormalized: { type: String, default: "", trim: true, index: true },
    source: {
      type: String,
      enum: Object.values(CRM_LEAD_SOURCE),
      default: CRM_LEAD_SOURCE.WEBSITE,
      index: true
    },
    sourceDetails: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: Object.values(CRM_LEAD_STATUS),
      default: CRM_LEAD_STATUS.NEW,
      index: true
    },
    assignedTo: {
      id: { type: String, default: "" },
      role: { type: String, default: "" },
      email: { type: String, default: "" },
      name: { type: String, default: "" }
    },
    interestedProducts: [{
      productId: { type: String, default: "" },
      productTitle: { type: String, default: "" },
      optionId: { type: String, default: "" },
      optionTitle: { type: String, default: "" }
    }],
    travelIntent: {
      travelDate: { type: String, default: "" },
      startTime: { type: String, default: "" },
      adults: { type: Number, default: 0 },
      children: { type: Number, default: 0 },
      totalParticipants: { type: Number, default: 0 },
      budgetAmount: { type: Number, default: null },
      budgetCurrency: { type: String, default: "USD", uppercase: true }
    },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null, index: true },
    convertedCustomerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null, index: true },
    convertedAt: { type: Date, default: null },
    lostReason: { type: String, default: "", trim: true },
    unqualifiedReason: { type: String, default: "", trim: true },
    lastContactedAt: { type: Date, default: null },
    nextFollowUpAt: { type: Date, default: null, index: true },
    notes: { type: String, default: "", trim: true },
    tags: { type: [String], default: [] },
    tagsNormalized: { type: [String], default: [] },
    externalReferences: { type: [externalReferenceSchema], default: [] },
    duplicateLeadOf: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null, index: true },
    duplicateReasons: { type: [String], default: [] },
    rawPayload: mongoose.Schema.Types.Mixed,
    createdBy: { type: actorSnapshotSchema, default: () => ({}) },
    updatedBy: { type: actorSnapshotSchema, default: () => ({}) }
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

leadSchema.pre("validate", function leadPreValidate(next) {
  this.fullName = `${this.firstName} ${this.lastName}`.trim();
  this.emailNormalized = normalizeEmail(this.email);
  this.phoneNormalized = normalizePhone(this.phone);
  this.whatsappNormalized = normalizePhone(this.whatsappNumber);
  this.tags = dedupeTags(this.tags || []);
  this.tagsNormalized = [...new Set(this.tags.map(normalizeTag).filter(Boolean))];
  this.externalReferences = (this.externalReferences || [])
    .map((reference) => ({
      ...reference,
      provider: normalizeToken(reference.provider).toLowerCase(),
      reference: normalizeToken(reference.reference),
      rawReference: normalizeToken(reference.rawReference || reference.reference)
    }))
    .filter((reference) => reference.provider && reference.reference);
  next();
});

leadSchema.index({ status: 1, updatedAt: -1 });
leadSchema.index({ source: 1, status: 1, createdAt: -1 });
leadSchema.index({ "assignedTo.id": 1, status: 1, nextFollowUpAt: 1 });
leadSchema.index({ tagsNormalized: 1, updatedAt: -1 });
leadSchema.index({ "externalReferences.provider": 1, "externalReferences.reference": 1 });

module.exports = mongoose.model("Lead", leadSchema);
