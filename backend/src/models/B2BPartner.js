const mongoose = require("mongoose");
const {
  CRM_B2B_COMMISSION_MODEL,
  CRM_B2B_NET_RATE_MODEL,
  CRM_B2B_PARTNER_STATUS,
  CRM_B2B_PARTNER_TYPE
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

const b2bPartnerSchema = new mongoose.Schema(
  {
    partnerNumber: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    partnerType: {
      type: String,
      enum: Object.values(CRM_B2B_PARTNER_TYPE),
      default: CRM_B2B_PARTNER_TYPE.B2B_PARTNER,
      index: true
    },
    companyName: { type: String, required: true, trim: true },
    companyNameNormalized: { type: String, default: "", lowercase: true, trim: true, index: true },
    contactPerson: { type: String, required: true, trim: true },
    email: { type: String, default: "", lowercase: true, trim: true },
    emailNormalized: { type: String, default: "", lowercase: true, trim: true },
    phone: { type: String, default: "", trim: true },
    phoneNormalized: { type: String, default: "", trim: true, index: true },
    country: { type: String, default: "", trim: true, index: true },
    commissionModel: {
      type: String,
      enum: Object.values(CRM_B2B_COMMISSION_MODEL),
      default: CRM_B2B_COMMISSION_MODEL.NONE
    },
    commissionRate: { type: Number, default: 0, min: 0, max: 100 },
    fixedCommissionAmount: { type: Number, default: 0, min: 0 },
    netRateModel: {
      type: String,
      enum: Object.values(CRM_B2B_NET_RATE_MODEL),
      default: CRM_B2B_NET_RATE_MODEL.NONE
    },
    creditLimit: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "USD", uppercase: true, trim: true },
    paymentTerms: { type: String, default: "", trim: true },
    assignedManager: { type: actorSnapshotSchema, default: () => ({}) },
    status: {
      type: String,
      enum: Object.values(CRM_B2B_PARTNER_STATUS),
      default: CRM_B2B_PARTNER_STATUS.PROSPECT,
      index: true
    },
    statusChangedAt: { type: Date, default: null, index: true },
    lastStatusChangeBy: { type: actorSnapshotSchema, default: () => ({}) },
    linkedAgentId: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", default: null, index: true },
    notes: { type: String, default: "", trim: true },
    externalReferences: { type: [externalReferenceSchema], default: [] },
    rawPayload: mongoose.Schema.Types.Mixed,
    createdBy: { type: actorSnapshotSchema, default: () => ({}) },
    updatedBy: { type: actorSnapshotSchema, default: () => ({}) }
  },
  { timestamps: true }
);

const normalizeToken = (value = "") => String(value || "").trim();
const normalizeEmail = (value = "") => normalizeToken(value).toLowerCase();
const normalizePhone = (value = "") => {
  const text = normalizeToken(value);
  if (!text) return "";
  const prefix = text.startsWith("+") ? "+" : "";
  const digits = text.replace(/[^\d]/g, "");
  return digits ? `${prefix}${digits}` : "";
};

b2bPartnerSchema.pre("validate", function b2bPartnerPreValidate(next) {
  this.companyNameNormalized = normalizeToken(this.companyName).toLowerCase();
  this.emailNormalized = normalizeEmail(this.email);
  this.phoneNormalized = normalizePhone(this.phone);
  this.currency = normalizeToken(this.currency || "USD").toUpperCase().slice(0, 3) || "USD";
  this.commissionRate = Math.min(Math.max(Number(this.commissionRate || 0), 0), 100);
  this.fixedCommissionAmount = Math.max(Number(this.fixedCommissionAmount || 0), 0);
  this.creditLimit = Math.max(Number(this.creditLimit || 0), 0);
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

b2bPartnerSchema.index(
  { emailNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: { emailNormalized: { $type: "string", $gt: "" } }
  }
);
b2bPartnerSchema.index({ companyNameNormalized: 1, country: 1 });
b2bPartnerSchema.index({ status: 1, updatedAt: -1 });
b2bPartnerSchema.index({ partnerType: 1, status: 1, updatedAt: -1 });
b2bPartnerSchema.index({ "assignedManager.id": 1, status: 1 });
b2bPartnerSchema.index({ "externalReferences.provider": 1, "externalReferences.reference": 1 });

module.exports = mongoose.model("B2BPartner", b2bPartnerSchema);
