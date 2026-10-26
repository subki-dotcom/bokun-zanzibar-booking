const mongoose = require("mongoose");

// Idempotency for guest change and cancel requests: the same key returns the first answer instead of a second request.
const myBookingActionKeySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
    action: { type: String, required: true },
    status: { type: String, enum: ["processing", "done"], default: "processing" },
    response: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

myBookingActionKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 2 * 24 * 60 * 60 });

module.exports = mongoose.model("MyBookingActionKey", myBookingActionKeySchema);
