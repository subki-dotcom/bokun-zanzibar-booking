const mongoose = require("mongoose");
const { BOOKING_STATUS, PAYMENT_STATUS } = require("../config/constants");

const bookingQuestionAnswerSchema = new mongoose.Schema(
  {
    questionId: { type: String, required: true },
    label: { type: String, required: true },
    scope: { type: String, enum: ["booking", "passenger"], default: "booking" },
    passengerIndex: { type: Number, default: null },
    answer: mongoose.Schema.Types.Mixed
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
    bookingReference: { type: String, required: true, unique: true, index: true },
    bokunBookingId: { type: String, default: "", index: true },
    bokunConfirmationCode: { type: String, default: "" },
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
      lineItems: [{ label: String, amount: Number }]
    },
    bookingQuestionsSnapshot: [bookingQuestionAnswerSchema],
    customer: {
      customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
      firstName: String,
      lastName: String,
      email: String,
      phone: String,
      country: String,
      hotelName: String
    },
    sourceChannel: { type: String, default: "direct_website" },
    createdByRole: { type: String, default: "customer" },
    createdByUser: {
      id: { type: String, default: null },
      name: { type: String, default: "Guest" }
    },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", default: null },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING
    },
    paymentTransactionId: { type: String, default: undefined },
    dpoTransactionToken: { type: String, default: undefined },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: "USD" },
    paymentMethod: { type: String, default: "pending" },
    bookingStatus: {
      type: String,
      enum: Object.values(BOOKING_STATUS),
      default: BOOKING_STATUS.PENDING
    },
    pendingCheckout: mongoose.Schema.Types.Mixed,
    cancellation: {
      reason: { type: String, default: "" },
      cancelledAt: Date,
      cancelledBy: { type: String, default: "" }
    },
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
        enum: ["webhook", "polling", "manual", "payment_callback", "system"],
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
    sparse: true,
    unique: true
  }
);

bookingSchema.index(
  { dpoTransactionToken: 1 },
  {
    sparse: true,
    unique: true
  }
);

module.exports = mongoose.model("Booking", bookingSchema);
