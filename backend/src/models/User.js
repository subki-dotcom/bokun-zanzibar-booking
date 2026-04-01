const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { ROLES } = require("../config/constants");

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    role: {
      type: String,
      enum: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
      default: ROLES.STAFF
    },
    phone: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date
  },
  { timestamps: true }
);

userSchema.pre("validate", function userPreValidate(next) {
  this.fullName = `${this.firstName} ${this.lastName}`.trim();
  next();
});

userSchema.pre("save", async function userPreSave(next) {
  if (!this.isModified("password")) {
    return next();
  }

  this.password = await bcrypt.hash(this.password, 12);
  return next();
});

userSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);