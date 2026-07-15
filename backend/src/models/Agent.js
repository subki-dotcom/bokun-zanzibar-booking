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
    address: { type: String, default: "" },
    agentType: {
      type: String,
      enum: ["hotel", "freelancer", "tour_agent", "partner", "other"],
      default: "partner"
    },
    profilePhotoUrl: { type: String, default: "" },
    referralCode: { type: String, unique: true, sparse: true, uppercase: true, trim: true, index: true },
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
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "suspended"],
      default: "approved"
    },
    termsAcceptedAt: Date,
    termsVersion: { type: String, default: "" },
    payoutMethod: {
      payoutMethod: { type: String, default: "" },
      accountHolderName: { type: String, default: "" },
      bankName: { type: String, default: "" },
      bankAccountNumber: { type: String, default: "" },
      bankBranch: { type: String, default: "" },
      mobileMoneyProvider: { type: String, default: "" },
      mobileMoneyNumber: { type: String, default: "" },
      paypalEmail: { type: String, default: "" },
      wiseEmail: { type: String, default: "" },
      payoutNotes: { type: String, default: "" },
      updatedAt: Date
    },
    settings: {
      language: { type: String, default: "English" },
      currency: { type: String, default: "USD" },
      emailNotifications: { type: Boolean, default: true },
      whatsappNotifications: { type: Boolean, default: true },
      bookingNotifications: { type: Boolean, default: true },
      cancellationNotifications: { type: Boolean, default: true },
      statementNotifications: { type: Boolean, default: true },
      statementFrequency: { type: String, default: "monthly" },
      twoFactorEnabled: { type: Boolean, default: false }
    },
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
