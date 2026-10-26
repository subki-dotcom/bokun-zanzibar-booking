const mongoose = require("mongoose");

// A one-time "My booking" sign-in link. Only the SHA-256 of the token is kept; the token itself is only in the email.
const bookingAccessLinkSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
    bookingReference: { type: String, required: true },
    email: { type: String, required: true },
    // lookup: asked for on the "Find your booking" form; email: inside a booking email.
    purpose: { type: String, enum: ["lookup", "email"], default: "lookup" },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    requestIp: { type: String, default: "" }
  },
  { timestamps: true }
);

// Expired links are removed by MongoDB a day after they stop working.
bookingAccessLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

module.exports = mongoose.model("BookingAccessLink", bookingAccessLinkSchema);
