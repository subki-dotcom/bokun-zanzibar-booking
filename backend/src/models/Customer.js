const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    phone: { type: String, default: "" },
    country: { type: String, default: "" },
    hotelName: { type: String, default: "" },
    notes: { type: String, default: "" },
    bookings: [{ type: mongoose.Schema.Types.ObjectId, ref: "Booking" }]
  },
  { timestamps: true }
);

customerSchema.pre("validate", function customerPreValidate(next) {
  this.fullName = `${this.firstName} ${this.lastName}`.trim();
  next();
});

module.exports = mongoose.model("Customer", customerSchema);