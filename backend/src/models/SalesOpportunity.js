const mongoose = require("mongoose");
const {
  CRM_LEAD_SOURCE,
  CRM_LOST_REASON,
  CRM_OPPORTUNITY_STAGE
} = require("../crm/constants");

const actorSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },
    role: { type: String, default: "" },
    email: { type: String, default: "" },
    name: { type: String, default: "" }
  },
  { _id: false }
);

const productInterestSchema = new mongoose.Schema(
  {
    productId: { type: String, default: "", trim: true },
    productTitle: { type: String, default: "", trim: true },
    optionId: { type: String, default: "", trim: true },
    optionTitle: { type: String, default: "", trim: true }
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

const salesOpportunitySchema = new mongoose.Schema(
  {
    opportunityNumber: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null, index: true },
    title: { type: String, required: true, trim: true },
    stage: {
      type: String,
      enum: Object.values(CRM_OPPORTUNITY_STAGE),
      default: CRM_OPPORTUNITY_STAGE.NEW,
      index: true
    },
    estimatedValue: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "USD", uppercase: true, trim: true },
    probability: { type: Number, default: 10, min: 0, max: 100 },
    expectedCloseDate: { type: Date, default: null, index: true },
    interestedProducts: { type: [productInterestSchema], default: [] },
    assignedTo: { type: actorSnapshotSchema, default: () => ({}) },
    source: {
      type: String,
      enum: Object.values(CRM_LEAD_SOURCE),
      default: CRM_LEAD_SOURCE.WEBSITE,
      index: true
    },
    notes: { type: String, default: "", trim: true },
    lostReason: {
      type: String,
      enum: [...Object.values(CRM_LOST_REASON), ""],
      default: "",
      trim: true
    },
    lostReasonNote: { type: String, default: "", trim: true },
    lostAt: { type: Date, default: null },
    wonBookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null, index: true },
    wonBokunBookingId: { type: String, default: "", trim: true, index: true },
    wonAt: { type: Date, default: null },
    stageChangedAt: { type: Date, default: null },
    lastStageChangeBy: { type: actorSnapshotSchema, default: () => ({}) },
    externalReferences: { type: [externalReferenceSchema], default: [] },
    rawPayload: mongoose.Schema.Types.Mixed,
    createdBy: { type: actorSnapshotSchema, default: () => ({}) },
    updatedBy: { type: actorSnapshotSchema, default: () => ({}) }
  },
  { timestamps: true }
);

const normalizeToken = (value = "") => String(value || "").trim();

salesOpportunitySchema.pre("validate", function opportunityPreValidate(next) {
  this.currency = normalizeToken(this.currency || "USD").toUpperCase().slice(0, 3) || "USD";
  this.probability = Math.min(Math.max(Number(this.probability || 0), 0), 100);
  this.estimatedValue = Math.max(Number(this.estimatedValue || 0), 0);
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

salesOpportunitySchema.index({ stage: 1, updatedAt: -1 });
salesOpportunitySchema.index({ source: 1, stage: 1, createdAt: -1 });
salesOpportunitySchema.index({ "assignedTo.id": 1, stage: 1, expectedCloseDate: 1 });
salesOpportunitySchema.index({ leadId: 1, stage: 1 });
salesOpportunitySchema.index({ customerId: 1, stage: 1 });
salesOpportunitySchema.index({ "externalReferences.provider": 1, "externalReferences.reference": 1 });

module.exports = mongoose.model("SalesOpportunity", salesOpportunitySchema);
