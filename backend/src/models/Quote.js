const mongoose = require("mongoose");
const {
  CRM_QUOTE_LINE_ITEM_TYPE,
  CRM_QUOTE_STATUS
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

const quoteLineItemSchema = new mongoose.Schema(
  {
    itemType: {
      type: String,
      enum: Object.values(CRM_QUOTE_LINE_ITEM_TYPE),
      default: CRM_QUOTE_LINE_ITEM_TYPE.CUSTOM_SERVICE,
      index: true
    },
    description: { type: String, required: true, trim: true },
    productId: { type: String, default: "", trim: true },
    productOptionId: { type: String, default: "", trim: true },
    quantity: { type: Number, default: 1, min: 0 },
    unitPrice: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    lineTotal: { type: Number, default: 0, min: 0 }
  },
  { _id: true }
);

const quoteSchema = new mongoose.Schema(
  {
    quoteNumber: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null, index: true },
    opportunityId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesOpportunity", default: null, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null, index: true },
    currency: { type: String, default: "USD", uppercase: true, trim: true },
    issueDate: { type: Date, default: null, index: true },
    validUntil: { type: Date, default: null, index: true },
    lineItems: { type: [quoteLineItemSchema], default: [] },
    subtotal: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: Object.values(CRM_QUOTE_STATUS),
      default: CRM_QUOTE_STATUS.DRAFT,
      index: true
    },
    notes: { type: String, default: "", trim: true },
    terms: { type: String, default: "", trim: true },
    priceLockedAt: { type: Date, default: null },
    createdBy: { type: actorSnapshotSchema, default: () => ({}) },
    updatedBy: { type: actorSnapshotSchema, default: () => ({}) },
    approvedBy: { type: actorSnapshotSchema, default: () => ({}) },
    sentAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    convertedAt: { type: Date, default: null },
    convertedBookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null, index: true },
    bokunBookingId: { type: String, default: "", trim: true, index: true },
    metadata: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

const normalizeText = (value = "") => String(value || "").trim();
const toMoney = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.max(amount, 0) : 0;
};
const roundMoney = (value) => Number(toMoney(value).toFixed(2));

const normalizeLineItem = (item = {}) => {
  const quantity = toMoney(item.quantity || 1);
  const unitPrice = toMoney(item.unitPrice);
  const discount = toMoney(item.discount);
  const tax = toMoney(item.tax);
  const gross = quantity * unitPrice;
  return {
    itemType: Object.values(CRM_QUOTE_LINE_ITEM_TYPE).includes(item.itemType)
      ? item.itemType
      : CRM_QUOTE_LINE_ITEM_TYPE.CUSTOM_SERVICE,
    description: normalizeText(item.description),
    productId: normalizeText(item.productId),
    productOptionId: normalizeText(item.productOptionId),
    quantity,
    unitPrice: roundMoney(unitPrice),
    discount: roundMoney(discount),
    tax: roundMoney(tax),
    lineTotal: roundMoney(Math.max(gross - discount + tax, 0))
  };
};

quoteSchema.pre("validate", function quotePreValidate(next) {
  this.currency = normalizeText(this.currency || "USD").toUpperCase().slice(0, 3) || "USD";
  this.quoteNumber = normalizeText(this.quoteNumber).toUpperCase();
  this.lineItems = (this.lineItems || []).map(normalizeLineItem).filter((item) => item.description);
  const totals = this.lineItems.reduce(
    (acc, item) => {
      const gross = toMoney(item.quantity) * toMoney(item.unitPrice);
      return {
        subtotal: acc.subtotal + gross,
        discount: acc.discount + toMoney(item.discount),
        tax: acc.tax + toMoney(item.tax)
      };
    },
    { subtotal: 0, discount: 0, tax: 0 }
  );
  this.subtotal = roundMoney(totals.subtotal);
  this.discount = roundMoney(totals.discount);
  this.tax = roundMoney(totals.tax);
  this.total = roundMoney(Math.max(totals.subtotal - totals.discount + totals.tax, 0));
  next();
});

quoteSchema.index({ status: 1, updatedAt: -1 });
quoteSchema.index({ customerId: 1, status: 1, updatedAt: -1 });
quoteSchema.index({ opportunityId: 1, status: 1, updatedAt: -1 });
quoteSchema.index({ leadId: 1, status: 1, updatedAt: -1 });
quoteSchema.index({ validUntil: 1, status: 1 });
quoteSchema.index({ bokunBookingId: 1, status: 1 });

module.exports = mongoose.model("Quote", quoteSchema);
