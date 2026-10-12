const mongoose = require("mongoose");
const { BOOKING_STATUS, PAYMENT_STATUS } = require("../config/constants");

const bookingQuestionAnswerSchema = new mongoose.Schema(
  {
    questionId: { type: String, required: true },
    label: { type: String, required: true },
    scope: { type: String, enum: ["booking", "pickup", "dropoff", "passenger"], default: "booking" },
    passengerIndex: { type: Number, default: null },
    answer: mongoose.Schema.Types.Mixed
  },
  { _id: false }
);

const bokunOperationalDateSchema = new mongoose.Schema(
  {
    raw: { type: String, default: "" },
    normalizedAt: { type: Date, default: null },
    localDate: { type: String, default: "" },
    localTime: { type: String, default: "" }
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
    bookingReference: { type: String, required: true, unique: true, index: true },
    bokunBookingId: { type: String, default: "", index: true },
    bokunConfirmationCode: { type: String, default: "" },
    // Operational customer-payment truth; legacy paymentStatus continues to
    // serve existing payment/accounting workflows during compatibility rollout.
    bookingPaymentStatus: { type: String, enum: ["PAID", "PARTIALLY_PAID", "UNPAID", "REFUNDED", "UNKNOWN"], default: "UNKNOWN" },
    bookingPaymentStatusSource: { type: String, enum: ["BOKUN", "LOCAL", "MANUAL_OVERRIDE", ""], default: "" },
    bookingPaymentReportedAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
    bookingPaymentCurrency: { type: String, default: "" },
    bookingPaymentStatusSyncedAt: { type: Date, default: null },
    bookingPaymentEvidenceHash: { type: String, default: "" },
    bokunPaymentSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    bokunFinancialEvidence: {
      source: { type: String, enum: ["", "BOKUN"], default: "" },
      status: { type: String, enum: ["", "VERIFIED", "NEEDS_REVIEW"], default: "" },
      bookingId: { type: String, default: "" },
      confirmationCode: { type: String, default: "" },
      experienceId: { type: String, default: "" },
      grossAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
      currency: { type: String, default: "", uppercase: true },
      reportedPaidAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
      paymentStatus: { type: String, default: "" },
      paymentMethod: { type: String, default: "" },
      bookingStatus: { type: String, default: "" },
      cancellationStatus: { type: String, default: "" },
      invoiceEvidence: { type: mongoose.Schema.Types.Mixed, default: [] },
      sellerInvoiceEvidence: { type: mongoose.Schema.Types.Mixed, default: null },
      paymentEvidence: { type: mongoose.Schema.Types.Mixed, default: [] },
      auditEvidence: { type: mongoose.Schema.Types.Mixed, default: [] },
      marketplaceContractId: { type: String, default: "" },
      marketplaceResellerId: { type: String, default: "" },
      marketplaceRelationship: { type: String, default: "" },
      otaCommissionAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
      otaCommissionCurrency: { type: String, default: "", uppercase: true },
      otaCommissionSource: { type: String, default: "" },
      otaCommissionStatus: { type: String, default: "" },
      expectedSellerInvoiceAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
      expectedSellerInvoiceCurrency: { type: String, default: "", uppercase: true },
      expectedSellerInvoiceSource: { type: String, default: "" },
      expectedNetReceivable: { type: mongoose.Schema.Types.Decimal128, default: null },
      settlementAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
      settlementCurrency: { type: String, default: "", uppercase: true },
      settlementEvidence: { type: mongoose.Schema.Types.Mixed, default: null },
      raw: { type: mongoose.Schema.Types.Mixed, default: null },
      evidenceHash: { type: String, default: "" },
      syncedAt: { type: Date, default: null },
      evidenceFetchedAt: { type: Date, default: null },
      retrievedAt: { type: Date, default: null },
      evidenceConflicts: [{ type: String }]
    },
    bookingPaymentConflict: { type: mongoose.Schema.Types.Mixed, default: null },
    bookingPaymentPendingAudit: { type: mongoose.Schema.Types.Mixed, default: null },
    bookingPaymentOverride: {
      locked: { type: Boolean, default: false },
      auditReference: { type: String, default: "" },
      reason: { type: String, default: "" }
    },
    bokunExternalBookingReference: { type: String, default: "", index: true },
    bokunProductId: { type: String, required: true },
    bokunOptionId: { type: String, required: true },
    productTitle: { type: String, required: true },
    optionTitle: { type: String, required: true },
    travelDate: { type: String, required: true },
    startTime: { type: String, default: "" },
    priceCatalog: {
      activityPriceCatalogId: { type: String, default: "" },
      catalogId: { type: String, default: "" },
      title: { type: String, default: "Default" }
    },
    paxSummary: {
      adults: { type: Number, default: 0 },
      children: { type: Number, default: 0 },
      infants: { type: Number, default: 0 },
      total: { type: Number, default: 0 }
    },
    priceCategoryParticipants: [
      {
        categoryId: String,
        title: String,
        ticketCategory: String,
        quantity: Number
      }
    ],
    extras: [
      {
        code: String,
        label: String,
        quantity: Number,
        amount: Number
      }
    ],
    pricingSnapshot: {
      currency: String,
      baseAmount: Number,
      extraAmount: Number,
      grossAmount: Number,
      discountAmount: Number,
      subsidyAmount: Number,
      finalPayable: Number,
      // quantity/unitPrice/total come from quotes and are read by invoices; amount is kept for legacy rows.
      lineItems: [{ label: String, quantity: Number, unitPrice: Number, total: Number, amount: Number }]
    },
    estimatedCostSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      immutable: true,
      default: null
    },
    bookingQuestionsSnapshot: [bookingQuestionAnswerSchema],
    customer: {
      customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
      firstName: String,
      lastName: String,
      email: String,
      phone: String,
      country: String,
      hotelName: String,
      pickupPlaceId: String
    },
    sourceChannel: { type: String, default: "direct_website" },
    rawChannelSource: { type: String, default: "" },
    externalChannelReference: { type: String, default: "", index: true },
    operationalSource: {
      type: String,
      enum: ["LOCAL", "BOKUN"],
      default: "LOCAL",
      index: true
    },
    salesChannel: {
      type: String,
      enum: [
        "DIRECT_WEBSITE",
        "VIATOR",
        "GETYOURGUIDE",
        "BOKUN_MARKETPLACE",
        "AGENT",
        "B2B",
        "HOTEL",
        "WHATSAPP",
        "WALK_IN",
        "TOURHQ",
        "AIRBNB",
        "OTHER"
      ],
      default: "DIRECT_WEBSITE",
      index: true
    },
    bokunStatus: {
      raw: { type: String, default: "" },
      normalized: {
        type: String,
        enum: ["unknown", "pending", "confirmed", "cancelled", "rejected", "timeout"],
        default: "unknown",
        index: true
      },
      sourceField: { type: String, default: "" },
      mappedAt: { type: Date, default: null }
    },
    bokunOperationalDates: {
      timezone: { type: String, default: "Africa/Dar_es_Salaam" },
      bookingCreatedAtBokun: { type: bokunOperationalDateSchema, default: () => ({}) },
      bookingConfirmedAtBokun: { type: bokunOperationalDateSchema, default: () => ({}) },
      travelDate: { type: bokunOperationalDateSchema, default: () => ({}) },
      activityDate: { type: bokunOperationalDateSchema, default: () => ({}) },
      activityStartTime: { type: bokunOperationalDateSchema, default: () => ({}) },
      pickupDate: { type: bokunOperationalDateSchema, default: () => ({}) },
      pickupTime: { type: bokunOperationalDateSchema, default: () => ({}) },
      endTime: { type: bokunOperationalDateSchema, default: () => ({}) },
      cancellationDate: { type: bokunOperationalDateSchema, default: () => ({}) },
      amendmentDate: { type: bokunOperationalDateSchema, default: () => ({}) },
      rescheduleDate: { type: bokunOperationalDateSchema, default: () => ({}) },
      bokunLastModifiedAt: { type: bokunOperationalDateSchema, default: () => ({}) },
      mappedAt: { type: Date, default: null }
    },
    bokunOperationalEvidence: {
      source: { type: String, default: "" },
      sourceField: { type: String, default: "" },
      activityStatus: { type: String, default: "" },
      activityBookingId: { type: String, default: "" },
      activityProductId: { type: String, default: "" },
      observedAt: { type: Date, default: null },
      mappedAt: { type: Date, default: null }
    },
    bokunImport: {
      firstImportedAt: { type: Date, default: null },
      lastImportedAt: { type: Date, default: null },
      lastSyncedAt: { type: Date, default: null },
      lastSyncSource: { type: String, default: "" },
      lastSyncRequestId: { type: String, default: "" },
      lastChangeType: { type: String, default: "" },
      lastError: { type: String, default: "" },
      snapshotHash: { type: String, default: "" },
      rawSalesChannel: { type: String, default: "" },
      salesChannelSourceField: { type: String, default: "" }
    },
    createdByRole: { type: String, default: "customer" },
    createdByUser: {
      id: { type: String, default: null },
      name: { type: String, default: "Guest" }
    },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", default: null },
    marketing: {
      referralCode: { type: String, default: "" },
      utmSource: { type: String, default: "" },
      utmMedium: { type: String, default: "" },
      utmCampaign: { type: String, default: "" },
      utmTerm: { type: String, default: "" },
      utmContent: { type: String, default: "" },
      landingPage: { type: String, default: "" },
      referrer: { type: String, default: "" }
    },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING
    },
    paymentTransactionId: { type: String, default: undefined },
    dpoTransactionToken: { type: String, default: undefined },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: "USD", uppercase: true },
    transactionCurrency: { type: String, default: "", uppercase: true },
    bokunCurrencySource: { type: String, default: "" },
    paymentMethod: { type: String, default: "pending" },
    refundStatus: {
      type: String,
      enum: [
        "not_requested",
        "not_required",
        "requested",
        "eligible",
        "pending_approval",
        "approved",
        "awaiting_merchant_approval",
        "processing",
        "verification_required",
        "partially_refunded",
        "refunded",
        "failed",
        "rejected",
        "cancelled",
        "manual_review",
        "manual_refund_required"
      ],
      default: "not_requested",
      index: true
    },
    amountRefunded: { type: Number, default: 0 },
    refundedAt: { type: Date, default: null },
    bookingStatus: {
      type: String,
      enum: Object.values(BOOKING_STATUS),
      default: BOOKING_STATUS.PENDING
    },
    // Supplier progress is intentionally distinct from paymentStatus. A paid
    // customer can still be waiting for Bókun without losing payment evidence.
    supplierStatus: {
      type: String,
      enum: ["awaiting_payment", "supplier_pending", "confirmed", "supplier_failed"],
      default: "awaiting_payment"
    },
    supplierStatusUpdatedAt: { type: Date, default: Date.now },
    supplierFailureReason: { type: String, default: "" },
    // Kept outside Mixed checkout snapshots so stale callback saves cannot
    // erase evidence that a supplier creation request may have been dispatched.
    bokunSubmissionStartedAt: { type: Date },
    // Durable provider-attempt ownership survives stale checkout snapshots.
    paymentInitiation: { type: mongoose.Schema.Types.Mixed, default: undefined },
    // Raising this revokes every customer access link issued for the booking (missing = 0).
    customerAccessVersion: { type: Number },
    // Where the booking entered the system (see services/bookings/origin.js). Written once at creation;
    // absent on older bookings, which are classified at read time. No index: no migration.
    bookingOrigin: { type: String, enum: ["WEBSITE", "AGENT_PORTAL", "BOKUN_IMPORT"] },
    // One pending emailed verification link: only its SHA-256 hash is stored, consumed atomically.
    customerAccessChallengeHash: { type: String, select: false },
    customerAccessChallengeExpiresAt: { type: Date, select: false },
    customerAccessChallengeRequestedAt: { type: Date, select: false },
    pendingCheckout: mongoose.Schema.Types.Mixed,
    // Only populated for paid legacy bookings that failed because the former
    // Bókun payload omitted a real pricingCategoryId.
    legacyBokunRecovery: {
      status: {
        type: String,
        enum: [
          "processing",
          "recovered",
          "reconciled",
          "handoff_to_standard_retry",
          "manual_review_required",
          "skipped"
        ],
        default: undefined
      },
      classification: { type: String, default: "" },
      attemptCount: { type: Number, default: 0 },
      recoveryAttemptedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
      lockToken: { type: String, default: "" },
      lockedAt: { type: Date, default: null },
      lastError: {
        code: { type: String, default: "" },
        statusCode: { type: Number, default: null },
        message: { type: String, default: "" },
        at: { type: Date, default: null }
      }
    },
    cancellation: {
      reason: { type: String, default: "" },
      cancelledAt: Date,
      cancelledBy: { type: String, default: "" }
    },
    cancellationPolicySnapshot: mongoose.Schema.Types.Mixed,
    editRequests: [
      {
        requestedAt: { type: Date, default: Date.now },
        requestedBy: String,
        reason: String,
        payload: mongoose.Schema.Types.Mixed,
        status: { type: String, default: "pending" }
      }
    ],
    syncState: {
      lastBokunSyncAt: Date,
      lastBokunSyncSource: {
        type: String,
        enum: ["webhook", "polling", "manual", "payment_callback", "payment_finalization", "system"],
        default: "system"
      },
      lastBokunStatus: { type: String, default: "" },
      lastBokunSyncError: { type: String, default: "" }
    },
    invoiceSnapshot: mongoose.Schema.Types.Mixed,
    rawBokunResponse: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

bookingSchema.index(
  { paymentTransactionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      paymentTransactionId: { $type: "string" }
    }
  }
);

bookingSchema.index(
  { dpoTransactionToken: 1 },
  {
    unique: true,
    partialFilterExpression: {
      dpoTransactionToken: { $type: "string" }
    }
  }
);

bookingSchema.index({
  paymentStatus: 1,
  bokunBookingId: 1,
  bokunConfirmationCode: 1,
  bookingStatus: 1,
  travelDate: 1,
  "pendingCheckout.finalization.status": 1,
  supplierStatus: 1,
  "legacyBokunRecovery.status": 1
});
bookingSchema.index({ operationalSource: 1, salesChannel: 1, bookingStatus: 1, travelDate: 1 });
bookingSchema.index({ salesChannel: 1, bookingStatus: 1, "bokunOperationalDates.bookingCreatedAtBokun.normalizedAt": 1 });
bookingSchema.index({ salesChannel: 1, bookingStatus: 1, "bokunOperationalDates.travelDate.normalizedAt": 1 });
bookingSchema.index({ salesChannel: 1, bookingStatus: 1, createdAt: 1 });
bookingSchema.index({ createdAt: -1, _id: -1 });
bookingSchema.index({ 'customer.customerId': 1, createdAt: 1 });
bookingSchema.index({ bokunBookingId: 1, bokunConfirmationCode: 1, "bokunStatus.normalized": 1 });
bookingSchema.index({ "bokunImport.lastSyncedAt": 1, "bokunImport.lastChangeType": 1 });
bookingSchema.index({ bokunBookingId: 1, bokunExternalBookingReference: 1, operationalSource: 1 });
bookingSchema.index({ "bokunOperationalDates.travelDate.localDate": 1, salesChannel: 1 });
bookingSchema.index({ "bokunOperationalDates.bokunLastModifiedAt.normalizedAt": 1 });

module.exports = mongoose.model("Booking", bookingSchema);
