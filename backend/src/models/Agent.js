const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { ROLES } = require("../config/constants");

const agentSchema = new mongoose.Schema(
  {
    companyName: { type: String, required: true, trim: true },
    contactFirstName: { type: String, required: true, trim: true },
    contactLastName: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, default: ROLES.AGENT, enum: [ROLES.AGENT] },
    phone: { type: String, default: "" },
    country: { type: String, default: "" },
    commissionPercent: { type: Number, default: null },
    productCommissionOverrides: [
      {
        bokunProductId: String,
        percent: Number
      }
    ],
    optionCommissionOverrides: [
      {
        bokunOptionId: String,
        percent: Number
      }
    ],
    payoutTerms: { type: String, default: "monthly" },
    isActive: { type: Boolean, default: true },
    notes: { type: String, default: "" }
  },
  { timestamps: true }
);

agentSchema.pre("validate", function agentPreValidate(next) {
  this.fullName = `${this.contactFirstName} ${this.contactLastName}`.trim();
  next();
});

agentSchema.pre("save", async function agentPreSave(next) {
  if (!this.isModified("password")) {
    return next();
  }

  this.password = await bcrypt.hash(this.password, 12);
  return next();
});

agentSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("Agent", agentSchema);
