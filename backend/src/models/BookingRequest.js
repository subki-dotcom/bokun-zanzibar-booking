const mongoose = require("mongoose");

const requestStatusValues = [
  "submitted",
  "under_review",
  "awaiting_customer_information",
  "awaiting_availability_check",
  "awaiting_additional_payment",
  "approved",
  "rejected",
  "processing",
  "completed",
  "cancelled_by_customer",
  "failed"
];

const refundStatusValues = [
  "not_required",
  "pending_approval",
  "approved",
  "processing",
  "partially_refunded",
  "refunded",
  "failed",
  "rejected",
  "cancelled",
  "manual_review"
];

const bokunSyncStatusValues = [
  "not_required",
  "pending",
  "checking_availability",
  "available",
  "unavailable",
  "syncing",
  "synced",
  "failed",
  "manual_action_required"
];

const travelersSchema = new mongoose.Schema(
  {
    adults: { type: Number, min: 0, default: 0 },
    children: { type: Number, min: 0, default: 0 },
    infants: { type: Number, min: 0, default: 0 },
    childAges: [{ type: Number, min: 0, max: 17 }]
  },
  { _id: false }
);

const bookingRequestSchema = new mongoose.Schema(
  {
    requestReference: { type: String, required: true, unique: true, index: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null, index: true },
    type: {
      type: String,
      enum: ["reschedule", "change_travelers", "cancel_booking", "combined_change"],
      required: true,
      index: true
    },
    // Present only while a request is active. The sparse unique index prevents
    // two concurrent submissions for the same booking and request type.
    activeRequestKey: { type: String, sparse: true, unique: true },
    status: { type: String, enum: requestStatusValues, default: "submitted", index: true },
    originalSnapshot: {
      date: String,
      startTime: String,
      travelers: travelersSchema,
      optionId: String,
      optionTitle: String,
      pickup: mongoose.Schema.Types.Mixed,
      totalAmount: Number,
      amountPaid: Number,
      currency: String
    },
    requestedChanges: {
      date: String,
      startTime: String,
      travelers: travelersSchema
    },
    customerReason: { type: String, required: true, trim: true, maxlength: 1500 },
    customerNotes: { type: String, default: "", trim: true, maxlength: 2500 },
    attachments: [
      {
        name: { type: String, maxlength: 180 },
        url: { type: String, maxlength: 1000 },
        uploadedAt: { type: Date, default: Date.now }
      }
    ],
    cancellationPolicySnapshot: mongoose.Schema.Types.Mixed,
    priceAdjustment: {
      originalAmount: { type: Number, default: 0 },
      newAmount: { type: Number, default: null },
      difference: { type: Number, default: null },
      type: { type: String, enum: ["none", "additional_payment", "refund", "unknown"], default: "unknown" },
      adminOverrideAmount: { type: Number, default: null },
      adminOverrideReason: { type: String, default: "" },
      checkedAt: { type: Date, default: null }
    },
    adminDecision: {
      decision: { type: String, enum: ["approved", "rejected", "more_information", ""], default: "" },
      customerFacingReason: { type: String, default: "" },
      internalNote: { type: String, default: "" },
      decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      decidedAt: { type: Date, default: null }
    },
    refund: {
      required: { type: Boolean, default: false },
      estimatedAmount: { type: Number, default: 0 },
      refundId: { type: mongoose.Schema.Types.ObjectId, ref: "Refund", default: null },
      status: { type: String, enum: refundStatusValues, default: "not_required" }
    },
    additionalPayment: {
      required: { type: Boolean, default: false },
      paymentAdjustmentId: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentAdjustment", default: null },
      status: { type: String, default: "not_required" }
    },
    bokunSync: {
      status: { type: String, enum: bokunSyncStatusValues, default: "not_required", index: true },
      attempts: { type: Number, default: 0 },
      lastAttemptAt: { type: Date, default: null },
      syncedAt: { type: Date, default: null },
      lastError: { type: String, default: "" },
      idempotencyKey: { type: String, required: true, unique: true, index: true },
      requestPayload: mongoose.Schema.Types.Mixed,
      responseSnapshot: mongoose.Schema.Types.Mixed,
      bokunBookingId: { type: String, default: "" },
      bokunConfirmationCode: { type: String, default: "" }
    },
    processingLock: {
      lockedAt: { type: Date, default: null },
      lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      action: { type: String, default: "" }
    },
    lastEmailTemplate: { type: String, default: "" },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

bookingRequestSchema.index({ booking: 1, type: 1, status: 1, createdAt: -1 });
bookingRequestSchema.index({ customer: 1, createdAt: -1 });

module.exports = mongoose.model("BookingRequest", bookingRequestSchema);
module.exports.REQUEST_STATUS_VALUES = requestStatusValues;
module.exports.REFUND_STATUS_VALUES = refundStatusValues;
module.exports.BOKUN_SYNC_STATUS_VALUES = bokunSyncStatusValues;
