const mongoose = require("mongoose");
const AppError = require("../../utils/AppError");

const { Schema } = mongoose;

const LOCATION_TYPES = Object.freeze(["AIRPORT", "PORT", "HOTEL", "AREA", "OTHER"]);
const INFANT_PRICING = Object.freeze({ EXCLUDED: "EXCLUDED", COUNTED: "COUNTED" });
const TRANSFER_CURRENCY = "USD";
const DEFAULT_MAX_ADVANCE_DAYS = 730;
const DEFAULT_TRIP_MINUTES = 90;
const DEFAULT_BUFFER_MINUTES = 30;
const MAX_ADVANCE_DAYS_LIMIT = 3650;

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
    // How far ahead customers may book (days). Configurable; two years by default.
    maxAdvanceDays: { type: Number, default: DEFAULT_MAX_ADVANCE_DAYS, min: 1, max: MAX_ADVANCE_DAYS_LIMIT },
    // Dispatch: how long a trip blocks its driver and vehicle when the route has no duration, and the gap kept
    // between two trips of the same driver or vehicle.
    defaultTripMinutes: { type: Number, default: DEFAULT_TRIP_MINUTES, min: 10, max: 1440 },
    assignmentBufferMinutes: { type: Number, default: DEFAULT_BUFFER_MINUTES, min: 0, max: 480 },
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

// Booking lifecycle. T2 only creates QUOTE_REQUESTED (no price yet) and AWAITING_PAYMENT (priced by the server).
// CONFIRMED is reached only after a server-verified payment or an approved cash-on-arrival arrangement.
const BOOKING_STATUS = Object.freeze({
  QUOTE_REQUESTED: "QUOTE_REQUESTED",
  AWAITING_PAYMENT: "AWAITING_PAYMENT",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED"
});
const PAYMENT_STATUS = Object.freeze({ UNPAID: "UNPAID", PAID: "PAID", REFUNDED: "REFUNDED" });
const BOOKING_SOURCES = Object.freeze(["WEBSITE", "MANUAL"]);
// MANUAL bookings and their channels exist only on historical records: Transfer Admin can no longer create bookings.
const MANUAL_CHANNELS = Object.freeze(["WHATSAPP", "PHONE", "EMAIL", "WALK_IN", "OTHER"]);
// ONLINE (Pesapal) is the only arrangement for new bookings. CASH_ON_ARRIVAL is kept so historical records stay valid.
const PAYMENT_ARRANGEMENTS = Object.freeze({ ONLINE: "ONLINE", CASH_ON_ARRIVAL: "CASH_ON_ARRIVAL" });

const PAYMENT_ALERTS = Object.freeze({ NONE: "", NEEDS_REFUND: "NEEDS_REFUND", PAYMENT_REVERSED: "PAYMENT_REVERSED" });

const bookingLegSchema = new Schema(
  {
    direction: { type: String, enum: ["OUTBOUND", "RETURN"], required: true },
    pickupLocationId: { type: Schema.Types.ObjectId, required: true },
    pickupLocationName: { type: String, required: true },
    pickupZoneCode: { type: String, default: "" },
    dropoffLocationId: { type: Schema.Types.ObjectId, required: true },
    dropoffLocationName: { type: String, required: true },
    dropoffZoneCode: { type: String, default: "" },
    // Local Zanzibar date/time as entered, and the same instant in UTC.
    localDate: { type: String, required: true },
    localTime: { type: String, required: true },
    pickupAt: { type: Date, required: true },
    routeId: { type: Schema.Types.ObjectId, default: null },
    rateId: { type: Schema.Types.ObjectId, default: null },
    tier: { minPassengers: Number, maxPassengers: Number },
    price: { type: Schema.Types.Decimal128, default: null },
    priceStatus: { type: String, enum: ["PRICED", "QUOTE_REQUIRED"], required: true },
    priceReason: { type: String, default: "" }
  },
  { _id: false }
);

const bookingSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true },
    source: { type: String, enum: BOOKING_SOURCES, default: "WEBSITE" },
    manualChannel: { type: String, enum: [...MANUAL_CHANNELS, ""], default: "" },
    createdBy: { id: { type: String, default: "" }, email: { type: String, default: "" } },
    status: { type: String, enum: Object.values(BOOKING_STATUS), required: true, index: true },
    paymentStatus: { type: String, enum: Object.values(PAYMENT_STATUS), default: PAYMENT_STATUS.UNPAID },
    paymentArrangement: { type: String, enum: Object.values(PAYMENT_ARRANGEMENTS), default: PAYMENT_ARRANGEMENTS.ONLINE },
    // Set by payment verification when money arrived that cannot be applied (the booking was already paid,
    // rejected or cancelled, or the amount differs), or a verified payment was later reversed. Staff handle it
    // in the Pesapal dashboard; the booking status itself is never changed by an alert.
    paymentAlert: { type: String, enum: Object.values(PAYMENT_ALERTS), default: PAYMENT_ALERTS.NONE, index: true },
    tripType: { type: String, enum: ["ONE_WAY", "ROUND_TRIP"], required: true },
    legs: { type: [bookingLegSchema], required: true },
    pickupAddress: { type: String, default: "" },
    dropoffAddress: { type: String, default: "" },
    passengers: {
      adults: { type: Number, required: true },
      children: { type: Number, default: 0 },
      infants: { type: Number, default: 0 },
      priced: { type: Number, required: true },
      capacity: { type: Number, required: true }
    },
    luggage: {
      largeBags: { type: Number, default: 0 },
      smallBags: { type: Number, default: 0 },
      notes: { type: String, default: "" }
    },
    flightNumber: { type: String, default: "" },
    customer: {
      fullName: { type: String, required: true },
      email: { type: String, required: true, lowercase: true },
      phone: { type: String, required: true },
      whatsapp: { type: Boolean, default: false }
    },
    specialRequests: { type: String, default: "" },
    pricing: {
      status: { type: String, enum: ["PRICED", "QUOTE_REQUIRED"], required: true },
      currency: { type: String, default: TRANSFER_CURRENCY },
      total: { type: Schema.Types.Decimal128, default: null },
      basis: { type: String, default: "PER_VEHICLE" },
      infantPricing: { type: String, default: INFANT_PRICING.EXCLUDED },
      reasons: { type: [String], default: [] },
      quotedAt: { type: Date, required: true }
    },
    // Every price this booking has had (engine price at submission, admin quotes); never rewritten.
    pricingHistory: [
      {
        _id: false,
        source: { type: String, enum: ["ENGINE", "ADMIN_QUOTE"] },
        status: String,
        total: { type: Schema.Types.Decimal128, default: null },
        legs: [{ _id: false, direction: String, price: { type: Schema.Types.Decimal128, default: null } }],
        at: Date,
        by: String,
        reason: String
      }
    ],
    statusHistory: [
      {
        _id: false,
        status: String,
        at: Date,
        by: String,
        note: String
      }
    ],
    // Duplicate-submission protection: the client's Idempotency-Key and a fingerprint of what it submitted.
    idempotencyKey: { type: String, required: true, unique: true, select: false },
    requestFingerprint: { type: String, required: true, select: false },
    // Random per-booking value; the customer's access token is an HMAC of it, so the token is never stored.
    accessNonce: { type: String, required: true, select: false }
  },
  { timestamps: true, collection: "transfer_bookings" }
);
// Payment rules enforced on every write, whichever code path makes it:
// - a new booking comes only from the website, unpaid, to be paid online, as a quote request or awaiting payment;
// - cash on arrival (kept only on historical records) can never be set again;
// - a booking becomes CONFIRMED or PAID only with a verified online payment, which the payment code marks with
//   `verifiedPayment` (the query option, or `$locals.verifiedPayment` on a document save).
const OPEN_BOOKING_STATUSES = [BOOKING_STATUS.QUOTE_REQUESTED, BOOKING_STATUS.AWAITING_PAYMENT];
const paymentRule = (message) => new AppError(message, 409, "TRANSFER_PAYMENT_RULE");
const newBookingProblem = (booking) =>
  booking.source !== "WEBSITE" ||
  (booking.paymentArrangement || PAYMENT_ARRANGEMENTS.ONLINE) !== PAYMENT_ARRANGEMENTS.ONLINE ||
  (booking.paymentStatus || PAYMENT_STATUS.UNPAID) !== PAYMENT_STATUS.UNPAID ||
  !OPEN_BOOKING_STATUSES.includes(booking.status);
const NEW_BOOKING_RULE = "New bookings are created only by customers on the website, unpaid, and are paid online.";
const CONFIRMATION_RULE = "A booking is confirmed or marked paid only after a verified online payment.";
const CASH_RULE = "Cash on arrival is not available; bookings are paid online.";

bookingSchema.pre("save", function guardBookingSave(next) {
  if (this.isNew) return next(newBookingProblem(this) ? paymentRule(NEW_BOOKING_RULE) : undefined);
  if (this.isModified("source") || (this.isModified("paymentArrangement") && this.paymentArrangement !== PAYMENT_ARRANGEMENTS.ONLINE)) return next(paymentRule(CASH_RULE));
  const confirming = (this.isModified("status") && this.status === BOOKING_STATUS.CONFIRMED) || (this.isModified("paymentStatus") && this.paymentStatus === PAYMENT_STATUS.PAID);
  return next(confirming && !this.$locals.verifiedPayment ? paymentRule(CONFIRMATION_RULE) : undefined);
});

bookingSchema.pre("insertMany", function guardBookingInsert(next, docs) {
  const list = Array.isArray(docs) ? docs : [docs];
  return next(list.some(newBookingProblem) ? paymentRule(NEW_BOOKING_RULE) : undefined);
});

function guardBookingUpdate(next) {
  const update = this.getUpdate() || {};
  const fields = { ...update, ...(update.$set || {}), ...(update.$setOnInsert || {}) };
  if (this.getOptions().upsert) return next(paymentRule(NEW_BOOKING_RULE));
  if (fields.source !== undefined || (fields.paymentArrangement !== undefined && fields.paymentArrangement !== PAYMENT_ARRANGEMENTS.ONLINE)) return next(paymentRule(CASH_RULE));
  const confirming = fields.status === BOOKING_STATUS.CONFIRMED || fields.paymentStatus === PAYMENT_STATUS.PAID;
  return next(confirming && !this.getOptions().verifiedPayment ? paymentRule(CONFIRMATION_RULE) : undefined);
}
["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace"].forEach((operation) => {
  bookingSchema.pre(operation, guardBookingUpdate);
});

bookingSchema.index({ createdAt: -1 });
bookingSchema.index({ "legs.pickupAt": 1 });
bookingSchema.index({ "customer.email": 1, createdAt: -1 });

// ---------- Fleet and dispatch ----------
const DRIVER_AVAILABILITY = Object.freeze(["AVAILABLE", "OFF_DUTY", "ON_LEAVE"]);
const VEHICLE_TYPES = Object.freeze(["SEDAN", "SUV", "VAN", "MINIBUS", "BUS", "OTHER"]);
const VEHICLE_OWNERSHIP = Object.freeze(["COMPANY", "PARTNER"]);
const VEHICLE_STATUS = Object.freeze(["AVAILABLE", "MAINTENANCE", "OUT_OF_SERVICE"]);
// Trip status is separate from booking status and payment status: completing a trip never marks a booking paid.
const TRIP_STATUS = Object.freeze({
  SCHEDULED: "SCHEDULED",
  DRIVER_EN_ROUTE: "DRIVER_EN_ROUTE",
  ARRIVED_AT_PICKUP: "ARRIVED_AT_PICKUP",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  NO_SHOW: "NO_SHOW"
});

const driverSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    whatsapp: { type: Boolean, default: false },
    licenseNumber: { type: String, required: true, trim: true, uppercase: true, unique: true },
    licenseClass: { type: String, default: "", trim: true },
    licenseExpiresOn: { type: String, default: "" },
    availability: { type: String, enum: DRIVER_AVAILABILITY, default: "AVAILABLE" },
    notes: { type: String, default: "", trim: true },
    active: { type: Boolean, default: true, index: true },
    // Bumped on every assignment so concurrent assignments of one driver conflict instead of double-booking.
    assignmentVersion: { type: Number, default: 0 }
  },
  { timestamps: true, collection: "transfer_drivers" }
);

const vehicleSchema = new Schema(
  {
    registrationNumber: { type: String, required: true, trim: true, uppercase: true, unique: true },
    makeModel: { type: String, default: "", trim: true },
    vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
    // Passenger seats, not counting the driver. Infants need a seat too.
    passengerCapacity: { type: Number, required: true, min: 1, max: 99 },
    luggageCapacity: { type: Number, default: null, min: 0, max: 200 },
    ownership: { type: String, enum: VEHICLE_OWNERSHIP, required: true },
    partnerName: { type: String, default: "", trim: true },
    operationalStatus: { type: String, enum: VEHICLE_STATUS, default: "AVAILABLE" },
    notes: { type: String, default: "", trim: true },
    active: { type: Boolean, default: true, index: true },
    assignmentVersion: { type: Number, default: 0 }
  },
  { timestamps: true, collection: "transfer_vehicles" }
);

// One trip per booking leg: a round trip has two trips, each assigned and progressed on its own.
const tripSchema = new Schema(
  {
    bookingId: { type: Schema.Types.ObjectId, required: true },
    bookingReference: { type: String, required: true },
    direction: { type: String, enum: ["OUTBOUND", "RETURN"], required: true },
    pickupAt: { type: Date, required: true, index: true },
    // Estimated end, used to detect overlapping assignments of a driver or vehicle.
    endAt: { type: Date, required: true },
    status: { type: String, enum: Object.values(TRIP_STATUS), default: TRIP_STATUS.SCHEDULED, index: true },
    driverId: { type: Schema.Types.ObjectId, default: null, index: true },
    vehicleId: { type: Schema.Types.ObjectId, default: null, index: true },
    assignedAt: { type: Date, default: null },
    assignedBy: { type: String, default: "" },
    assignmentHistory: [
      {
        _id: false,
        action: { type: String, enum: ["ASSIGNED", "REASSIGNED", "UNASSIGNED"] },
        driverId: Schema.Types.ObjectId,
        driverName: String,
        vehicleId: Schema.Types.ObjectId,
        registrationNumber: String,
        at: Date,
        by: String,
        reason: String
      }
    ],
    statusHistory: [{ _id: false, status: String, at: Date, by: String, note: String }],
    // Every change bumps the version; actions name the version they saw, so a repeated or stale action is refused.
    version: { type: Number, default: 0 }
  },
  { timestamps: true, collection: "transfer_trips" }
);
tripSchema.index({ bookingId: 1, direction: 1 }, { unique: true });
tripSchema.index({ driverId: 1, pickupAt: 1 });
tripSchema.index({ vehicleId: 1, pickupAt: 1 });
tripSchema.index({ "assignmentHistory.driverId": 1 });
tripSchema.index({ "assignmentHistory.vehicleId": 1 });

const registry = new WeakMap();

// ---------- Popular routes ----------
// A bookable product on the website: a fixed pickup and drop-off for the booking widget. It holds no price: the price
// always comes from the zones, routes and rates. Inclusions are shown only when staff have switched them on.
const ROUTE_INCLUSIONS = Object.freeze(["PRIVATE_VEHICLE", "PROFESSIONAL_DRIVER", "FUEL_INCLUDED", "HOTEL_PICKUP", "HOTEL_DROPOFF", "LUGGAGE_ASSISTANCE"]);

const popularRouteSchema = new Schema(
  {
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    title: { type: String, required: true, trim: true },
    pickupLocationId: { type: Schema.Types.ObjectId, ref: "TransferLocation", required: true },
    dropoffLocationId: { type: Schema.Types.ObjectId, ref: "TransferLocation", required: true },
    description: { type: String, default: "", trim: true },
    inclusions: { type: [{ type: String, enum: ROUTE_INCLUSIONS }], default: ["PRIVATE_VEHICLE"] },
    displayOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true, index: true }
  },
  { timestamps: true, collection: "transfer_popular_routes" }
);
popularRouteSchema.index({ active: 1, displayOrder: 1 });

// ---------- Payments ----------
// One record per Pesapal checkout attempt. Only the payment service writes them, and only from what Pesapal's
// transaction status says (never from the customer's browser).
const TRANSFER_PAYMENT_STATUS = Object.freeze({ PENDING: "PENDING", PAID: "PAID", FAILED: "FAILED", CANCELLED: "CANCELLED", REVERSED: "REVERSED" });
// What a verified payment did: confirmed its booking, or could not be applied and must be refunded by staff.
const TRANSFER_PAYMENT_OUTCOME = Object.freeze({ NONE: "", APPLIED: "APPLIED", NEEDS_REFUND: "NEEDS_REFUND" });

const paymentSchema = new Schema(
  {
    bookingId: { type: Schema.Types.ObjectId, required: true, index: true },
    bookingReference: { type: String, required: true, index: true },
    provider: { type: String, enum: ["PESAPAL"], default: "PESAPAL" },
    // Our id for the Pesapal order (sent as `id`) and Pesapal's id for it.
    merchantReference: { type: String, required: true, unique: true },
    orderTrackingId: { type: String },
    amount: { type: Schema.Types.Decimal128, required: true },
    currency: { type: String, default: TRANSFER_CURRENCY },
    status: { type: String, enum: Object.values(TRANSFER_PAYMENT_STATUS), default: TRANSFER_PAYMENT_STATUS.PENDING, index: true },
    outcome: { type: String, enum: Object.values(TRANSFER_PAYMENT_OUTCOME), default: TRANSFER_PAYMENT_OUTCOME.NONE },
    outcomeReason: { type: String, default: "" },
    failureReason: { type: String, default: "" },
    // Evidence from Pesapal's GetTransactionStatus.
    providerStatus: { type: String, default: "" },
    providerStatusCode: { type: Number, default: null },
    paidAmount: { type: String, default: "" },
    paidCurrency: { type: String, default: "" },
    paymentMethod: { type: String, default: "" },
    confirmationCode: { type: String, default: "" },
    verifiedAt: { type: Date, default: null },
    lastCheckedAt: { type: Date, default: null },
    checks: [{ _id: false, at: Date, source: String, status: String, statusCode: Number, by: String }]
  },
  { timestamps: true, collection: "transfer_payments" }
);
paymentSchema.index({ orderTrackingId: 1 }, { unique: true, partialFilterExpression: { orderTrackingId: { $type: "string" } } });

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
    AuditLog: connection.model("TransferAuditLog", auditLogSchema),
    Booking: connection.model("TransferBooking", bookingSchema),
    Driver: connection.model("TransferDriver", driverSchema),
    Vehicle: connection.model("TransferVehicle", vehicleSchema),
    Trip: connection.model("TransferTrip", tripSchema),
    Payment: connection.model("TransferPayment", paymentSchema),
    PopularRoute: connection.model("TransferPopularRoute", popularRouteSchema)
  };
  registry.set(connection, models);
  return models;
};

module.exports = {
  LOCATION_TYPES,
  INFANT_PRICING,
  TRANSFER_CURRENCY,
  DEFAULT_MAX_ADVANCE_DAYS,
  MAX_ADVANCE_DAYS_LIMIT,
  BOOKING_STATUS,
  PAYMENT_STATUS,
  BOOKING_SOURCES,
  MANUAL_CHANNELS,
  PAYMENT_ARRANGEMENTS,
  PAYMENT_ALERTS,
  ROUTE_INCLUSIONS,
  TRANSFER_PAYMENT_STATUS,
  TRANSFER_PAYMENT_OUTCOME,
  DEFAULT_TRIP_MINUTES,
  DEFAULT_BUFFER_MINUTES,
  DRIVER_AVAILABILITY,
  VEHICLE_TYPES,
  VEHICLE_OWNERSHIP,
  VEHICLE_STATUS,
  TRIP_STATUS,
  defineTransferModels
};
