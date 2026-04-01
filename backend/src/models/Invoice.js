const mongoose = require("mongoose");
const { PAYMENT_STATUS, BOOKING_STATUS } = require("../config/constants");

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    bookingReference: { type: String, required: true, index: true },
    issueDate: { type: Date, default: Date.now },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING
    },
    bookingStatus: {
      type: String,
      enum: Object.values(BOOKING_STATUS),
      default: BOOKING_STATUS.CONFIRMED
    },
    clientName: String,
    clientPhone: String,
    clientEmail: String,
    clientCountry: String,
    hotelName: String,
    tourName: String,
    bookedOption: String,
    tourDate: String,
    pickupTime: String,
    pickupLocation: String,
    dropoffLocation: String,
    duration: String,
    adults: Number,
    children: Number,
    totalPax: Number,
    guideLanguage: String,
    included: [{ type: String }],
    excluded: [{ type: String }],
    items: [
      {
        label: String,
        quantity: Number,
        unitPrice: Number,
        total: Number
      }
    ],
    subtotal: Number,
    discount: Number,
    tax: Number,
    total: Number,
    amountPaid: Number,
    balanceDue: Number,
    paymentMethod: String,
    notes: String,
    cancellationPolicy: String,
    paymentTerms: String
  },
  { timestamps: true }
);

module.exports = mongoose.model("Invoice", invoiceSchema);