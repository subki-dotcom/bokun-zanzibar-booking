const mongoose = require("mongoose");

// A guest signed in to one booking (httpOnly cookie). Only the SHA-256 of the cookie value is kept.
const bookingSessionSchema = new mongoose.Schema(
  {
    sessionHash: { type: String, required: true, unique: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
    bookingReference: { type: String, required: true },
    email: { type: String, required: true },
    // magic_link | payment_key
    source: { type: String, default: "magic_link" },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
    createdIp: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    // The code emailed before full contact details are shown.
    contactCode: {
      hash: { type: String, default: "" },
      expiresAt: { type: Date, default: null },
      attempts: { type: Number, default: 0 }
    },
    contactVerifiedUntil: { type: Date, default: null }
  },
  { timestamps: true }
);

bookingSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

module.exports = mongoose.model("BookingSession", bookingSessionSchema);
