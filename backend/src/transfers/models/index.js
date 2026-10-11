const mongoose = require("mongoose");
const AppError = require("../../utils/AppError");

const { Schema } = mongoose;

const LOCATION_TYPES = Object.freeze(["AIRPORT", "PORT", "HOTEL", "AREA", "OTHER"]);
const INFANT_PRICING = Object.freeze({ EXCLUDED: "EXCLUDED", COUNTED: "COUNTED" });
const TRANSFER_CURRENCY = "USD";

const zoneSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    active: { type: Boolean, default: true, index: true }
  },
  { timestamps: true, collection: "transfer_zones" }
);

const locationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: LOCATION_TYPES, required: true },
    zoneId: { type: Schema.Types.ObjectId, ref: "TransferZone", required: true, index: true },
    address: { type: String, default: "", trim: true },
    aliases: { type: [String], default: [] },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true, index: true }
  },
  { timestamps: true, collection: "transfer_locations" }
);
locationSchema.index({ name: 1, zoneId: 1 }, { unique: true });

const routeSchema = new Schema(
  {
    fromZoneId: { type: Schema.Types.ObjectId, ref: "TransferZone", required: true },
    toZoneId: { type: Schema.Types.ObjectId, ref: "TransferZone", required: true },
    // A bidirectional route prices both directions with the same tiers.
    bidirectional: { type: Boolean, default: true },
    durationMinutes: { type: Number, default: null, min: 0 },
    distanceKm: { type: Number, default: null, min: 0 },
    notes: { type: String, default: "", trim: true },
    active: { type: Boolean, default: true, index: true },
    // Bumped whenever the route's rates change, so concurrent rate edits on one route conflict instead of
    // both passing the overlap check.
    ratesVersion: { type: Number, default: 0 }
  },
  { timestamps: true, collection: "transfer_routes" }
);
routeSchema.index({ fromZoneId: 1, toZoneId: 1 }, { unique: true });

const rateSchema = new Schema(
  {
    routeId: { type: Schema.Types.ObjectId, ref: "TransferRoute", required: true, index: true },
    minPassengers: { type: Number, required: true, min: 1 },
    maxPassengers: { type: Number, required: true, min: 1 },
    price: { type: Schema.Types.Decimal128, required: true },
    currency: { type: String, enum: [TRANSFER_CURRENCY], default: TRANSFER_CURRENCY },
    basis: { type: String, enum: ["PER_VEHICLE"], default: "PER_VEHICLE" },
    active: { type: Boolean, default: true, index: true }
  },
  { timestamps: true, collection: "transfer_rates" }
);
rateSchema.index({ routeId: 1, active: 1, minPassengers: 1 });

const settingsSchema = new Schema(
  {
    key: { type: String, default: "pricing", unique: true },
    // Infants always count toward vehicle capacity (safety); whether they count toward the price tier is configurable.
    infantPricing: { type: String, enum: Object.values(INFANT_PRICING), default: INFANT_PRICING.EXCLUDED },
    currency: { type: String, enum: [TRANSFER_CURRENCY], default: TRANSFER_CURRENCY }
  },
  { timestamps: true, collection: "transfer_settings" }
);

const adminUserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    tokenVersion: { type: Number, default: 0 },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    createdBy: { type: String, default: "" }
  },
  { timestamps: true, collection: "transfer_admin_users" }
);

const auditLogSchema = new Schema(
  {
    actorId: { type: String, default: "" },
    actorEmail: { type: String, default: "" },
    actorRole: { type: String, default: "" },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, default: "" },
    reason: { type: String, default: "" },
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    requestId: { type: String, default: "" },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" }
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "transfer_audit_logs" }
);
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });

const immutable = () => new AppError("Transfer audit logs cannot be changed or deleted.", 409, "TRANSFER_AUDIT_IMMUTABLE");
auditLogSchema.pre("save", function preventUpdate(next) {
  return this.isNew ? next() : next(immutable());
});
["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"].forEach((operation) => {
  auditLogSchema.pre(operation, (next) => next(immutable()));
});

const registry = new WeakMap();

// Models are bound to the Transfer System connection only, never to the Business Platform connection.
const defineTransferModels = (connection) => {
  if (registry.has(connection)) return registry.get(connection);
  const models = {
    Zone: connection.model("TransferZone", zoneSchema),
    Location: connection.model("TransferLocation", locationSchema),
    Route: connection.model("TransferRoute", routeSchema),
    Rate: connection.model("TransferRate", rateSchema),
    Settings: connection.model("TransferSettings", settingsSchema),
    AdminUser: connection.model("TransferAdminUser", adminUserSchema),
    AuditLog: connection.model("TransferAuditLog", auditLogSchema)
  };
  registry.set(connection, models);
  return models;
};

module.exports = {
  LOCATION_TYPES,
  INFANT_PRICING,
  TRANSFER_CURRENCY,
  defineTransferModels
};
