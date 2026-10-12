const { z } = require("zod");
const { LOCATION_TYPES, INFANT_PRICING, MAX_ADVANCE_DAYS_LIMIT, DRIVER_AVAILABILITY, VEHICLE_TYPES, VEHICLE_OWNERSHIP, VEHICLE_STATUS, TRIP_STATUS } = require("./models");
const { TRANSFER_ROLES } = require("./security/permissions");
const { TRIP_TYPES, MAX_PASSENGERS } = require("./pricing/engine");
const { passwordSchema } = require("./security/password");

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");
const text = (max) => z.string().trim().max(max);
const reason = text(500).optional();
const idParams = (name) => z.object({ [name]: objectId });
const anyQuery = z.object({}).passthrough();
const noQuery = z.object({}).passthrough();

const count = z.coerce.number().int().min(0).max(MAX_PASSENGERS);
// Prices are strings so cents are exact; numbers are accepted and converted.
const price = z.union([z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Price must be an amount with at most 2 decimals"), z.number().positive()]).transform(String);

const loginSchema = z.object({
  body: z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) }).strict(),
  query: noQuery,
  params: z.object({}).passthrough()
});

const changePasswordSchema = z.object({
  body: z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }).strict(),
  query: noQuery,
  params: z.object({}).passthrough()
});

const emptyBodySchema = z.object({ body: z.object({}).strict().optional(), query: noQuery, params: z.object({}).passthrough() });

const listSchema = z.object({ body: z.any().optional(), query: anyQuery, params: z.object({}).passthrough() });

const zoneBody = {
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, - or _"),
  name: text(100).min(1),
  description: text(500).optional(),
  active: z.boolean().optional()
};
const createZoneSchema = z.object({ body: z.object(zoneBody).strict(), query: noQuery, params: z.object({}).passthrough() });
const updateZoneSchema = z.object({
  body: z.object({ code: zoneBody.code.optional(), name: zoneBody.name.optional(), description: zoneBody.description, active: zoneBody.active, reason }).strict(),
  query: noQuery,
  params: idParams("zoneId")
});

const locationBody = {
  name: text(150).min(1),
  type: z.enum(LOCATION_TYPES),
  zoneId: objectId,
  address: text(300).optional(),
  aliases: z.array(text(100).min(1)).max(20).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  active: z.boolean().optional()
};
const createLocationSchema = z.object({ body: z.object(locationBody).strict(), query: noQuery, params: z.object({}).passthrough() });
const updateLocationSchema = z.object({
  body: z.object({ ...Object.fromEntries(Object.entries(locationBody).map(([key, value]) => [key, value.optional()])), reason }).strict(),
  query: noQuery,
  params: idParams("locationId")
});

const routeBody = {
  bidirectional: z.boolean().optional(),
  durationMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
  distanceKm: z.number().min(0).max(5000).nullable().optional(),
  notes: text(500).optional(),
  active: z.boolean().optional()
};
const createRouteSchema = z.object({
  body: z.object({ fromZoneId: objectId, toZoneId: objectId, ...routeBody }).strict(),
  query: noQuery,
  params: z.object({}).passthrough()
});
// The zones of a route are fixed once created; create a new route for other zones.
const updateRouteSchema = z.object({ body: z.object({ ...routeBody, reason }).strict(), query: noQuery, params: idParams("routeId") });

const createRateSchema = z.object({
  body: z
    .object({
      routeId: objectId,
      minPassengers: z.number().int().min(1).max(MAX_PASSENGERS),
      maxPassengers: z.number().int().min(1).max(MAX_PASSENGERS),
      price,
      active: z.boolean().optional()
    })
    .strict(),
  query: noQuery,
  params: z.object({}).passthrough()
});
const updateRateSchema = z.object({
  body: z
    .object({
      minPassengers: z.number().int().min(1).max(MAX_PASSENGERS).optional(),
      maxPassengers: z.number().int().min(1).max(MAX_PASSENGERS).optional(),
      price: price.optional(),
      active: z.boolean().optional(),
      reason
    })
    .strict(),
  query: noQuery,
  params: idParams("rateId")
});

const updateSettingsSchema = z.object({
  body: z
    .object({
      infantPricing: z.enum(Object.values(INFANT_PRICING)).optional(),
      maxAdvanceDays: z.number().int().min(1).max(MAX_ADVANCE_DAYS_LIMIT).optional(),
      defaultTripMinutes: z.number().int().min(10).max(1440).optional(),
      assignmentBufferMinutes: z.number().int().min(0).max(480).optional(),
      reason
    })
    .strict()
    .refine((body) => ["infantPricing", "maxAdvanceDays", "defaultTripMinutes", "assignmentBufferMinutes"].some((field) => body[field] !== undefined), "Nothing to update"),
  query: noQuery,
  params: z.object({}).passthrough()
});

// No price field: the server always prices from the database.
const quoteSchema = z.object({
  body: z
    .object({
      tripType: z.enum(Object.values(TRIP_TYPES)).default(TRIP_TYPES.ONE_WAY),
      pickupLocationId: objectId,
      dropoffLocationId: objectId,
      passengers: z.object({ adults: count.min(1), children: count.default(0), infants: count.default(0) }).strict()
    })
    .strict(),
  query: noQuery,
  params: z.object({}).passthrough()
});

const roleEnum = z.enum(Object.values(TRANSFER_ROLES));
const createUserSchema = z.object({
  body: z.object({ name: text(100).min(1), email: z.string().trim().toLowerCase().email().max(200), role: roleEnum, password: passwordSchema }).strict(),
  query: noQuery,
  params: z.object({}).passthrough()
});
const updateUserSchema = z.object({
  body: z.object({ name: text(100).min(1).optional(), role: roleEnum.optional(), isActive: z.boolean().optional(), unlock: z.boolean().optional(), reason }).strict(),
  query: noQuery,
  params: idParams("userId")
});
const resetPasswordSchema = z.object({
  body: z.object({ password: passwordSchema, reason }).strict(),
  query: noQuery,
  params: idParams("userId")
});


// ---------- Public (website) ----------
// Airline formats vary (PW 1234, KQ-488, TK0605, 5H123, ICAO codes such as ATC123); accept letters, digits, one
// space or hyphen, 2–12 characters, with at least one digit.
const FLIGHT_NUMBER_PATTERN = /^(?=.*\d)[A-Z0-9](?:[A-Z0-9]|[ -](?=[A-Z0-9])){1,11}$/;
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");
const optionalText = (max) => z.string().trim().max(max).optional().default("");
const publicQuoteSchema = quoteSchema;

// Fields shared by website and staff-entered bookings. Neither carries a price: the server prices every booking.
const bookingFields = {
  tripType: z.enum(Object.values(TRIP_TYPES)),
  pickupLocationId: objectId,
  dropoffLocationId: objectId,
  travelDate: localDate,
  travelTime: localTime,
  returnDate: localDate.optional(),
  returnTime: localTime.optional(),
  passengers: z.object({ adults: count.min(1), children: count.default(0), infants: count.default(0) }).strict(),
  luggage: z
    .object({ largeBags: z.coerce.number().int().min(0).max(40).default(0), smallBags: z.coerce.number().int().min(0).max(40).default(0), notes: optionalText(300) })
    .strict()
    .default({}),
  flightNumber: z.string().trim().toUpperCase().regex(FLIGHT_NUMBER_PATTERN, "Enter the flight number as shown on your ticket").or(z.literal("")).optional().default(""),
  pickupAddress: optionalText(300),
  dropoffAddress: optionalText(300),
  customer: z
    .object({
      fullName: z.string().trim().min(2).max(120),
      email: z.string().trim().toLowerCase().email().max(200),
      phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,24}$/, "Enter a valid phone number").refine((value) => value.replace(/\D/g, "").length >= 7, "Enter a valid phone number"),
      whatsapp: z.boolean().optional().default(false)
    })
    .strict(),
  specialRequests: optionalText(1000),
  // The total the customer saw (null when they saw "Request a Quote"); never used as the price.
  expectedTotal: z.union([z.string().regex(/^\d+(\.\d{1,2})?$/), z.null()])
};

const returnRule = (body, ctx) => {
  const hasReturn = body.returnDate !== undefined || body.returnTime !== undefined;
  if (body.tripType === TRIP_TYPES.ROUND_TRIP && (!body.returnDate || !body.returnTime)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["returnDate"], message: "Return date and time are required for a round trip" });
  }
  if (body.tripType === TRIP_TYPES.ONE_WAY && hasReturn) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["returnDate"], message: "A one-way transfer has no return" });
  }
};

const publicBookingSchema = z.object({
  body: z
    .object({
      ...bookingFields,
      // Honeypot: hidden on the form, so people leave it empty.
      website: z.string().max(0, "Rejected").optional()
    })
    .strict()
    .superRefine(returnRule),
  query: noQuery,
  params: z.object({}).passthrough()
});

const bookingIdParams = z.object({ bookingId: objectId });
const requiredReason = z.string().trim().min(3, "Give a reason").max(500);
const bookingReasonSchema = z.object({ body: z.object({ reason: requiredReason }).strict(), query: noQuery, params: bookingIdParams });
const bookingQuoteSchema = z.object({
  body: z
    .object({
      legs: z.array(z.object({ direction: z.enum(["OUTBOUND", "RETURN"]), price }).strict()).min(1).max(2),
      reason: requiredReason
    })
    .strict(),
  query: noQuery,
  params: bookingIdParams
});
const bookingIdSchema = z.object({ body: z.any().optional(), query: noQuery, params: bookingIdParams });

const publicBookingLookupSchema = z.object({
  body: z.any().optional(),
  query: noQuery,
  params: z.object({ reference: z.string().trim().toUpperCase().max(20) })
});

// ---------- Fleet and dispatch ----------
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const phone = z.string().trim().regex(/^\+?[0-9 ()-]{7,24}$/, "Enter a valid phone number");
const driverFields = {
  fullName: text(120).min(2),
  phone,
  whatsapp: z.boolean().optional(),
  licenseNumber: z.string().trim().min(3).max(40),
  licenseClass: text(40).optional(),
  licenseExpiresOn: isoDate.or(z.literal("")).optional(),
  availability: z.enum(DRIVER_AVAILABILITY).optional(),
  notes: text(500).optional(),
  active: z.boolean().optional()
};
const createDriverSchema = z.object({ body: z.object(driverFields).strict(), query: noQuery, params: z.object({}).passthrough() });
const updateDriverSchema = z.object({
  body: z.object({ ...Object.fromEntries(Object.entries(driverFields).map(([key, value]) => [key, value.optional()])), reason }).strict(),
  query: noQuery,
  params: idParams("driverId")
});

const vehicleFields = {
  registrationNumber: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9 -]+$/, "Use letters, numbers, spaces or -"),
  makeModel: text(80).optional(),
  vehicleType: z.enum(VEHICLE_TYPES),
  passengerCapacity: z.number().int().min(1).max(99),
  luggageCapacity: z.number().int().min(0).max(200).nullable().optional(),
  ownership: z.enum(VEHICLE_OWNERSHIP),
  partnerName: text(120).optional(),
  operationalStatus: z.enum(VEHICLE_STATUS).optional(),
  notes: text(500).optional(),
  active: z.boolean().optional()
};
const createVehicleSchema = z.object({ body: z.object(vehicleFields).strict(), query: noQuery, params: z.object({}).passthrough() });
const updateVehicleSchema = z.object({
  body: z.object({ ...Object.fromEntries(Object.entries(vehicleFields).map(([key, value]) => [key, value.optional()])), reason }).strict(),
  query: noQuery,
  params: idParams("vehicleId")
});

const tripParams = idParams("tripId");
const expectedVersion = z.number().int().min(0);
const assignTripSchema = z.object({
  body: z.object({ driverId: objectId, vehicleId: objectId, expectedVersion, reason: text(500).optional() }).strict(),
  query: noQuery,
  params: tripParams
});
const unassignTripSchema = z.object({ body: z.object({ expectedVersion, reason: z.string().trim().min(3).max(500) }).strict(), query: noQuery, params: tripParams });
const tripStatusSchema = z.object({
  body: z.object({ status: z.enum(Object.values(TRIP_STATUS)), expectedVersion, note: text(500).optional() }).strict(),
  query: noQuery,
  params: tripParams
});
const tripIdSchema = z.object({ body: z.any().optional(), query: noQuery, params: tripParams });
const driverIdSchema = z.object({ body: z.any().optional(), query: noQuery, params: idParams("driverId") });
const vehicleIdSchema = z.object({ body: z.any().optional(), query: noQuery, params: idParams("vehicleId") });

module.exports = {
  createDriverSchema,
  updateDriverSchema,
  createVehicleSchema,
  updateVehicleSchema,
  assignTripSchema,
  unassignTripSchema,
  tripStatusSchema,
  tripIdSchema,
  driverIdSchema,
  vehicleIdSchema,
  FLIGHT_NUMBER_PATTERN,
  publicQuoteSchema,
  publicBookingSchema,
  publicBookingLookupSchema,
  bookingReasonSchema,
  bookingQuoteSchema,
  bookingIdSchema,
  loginSchema,
  changePasswordSchema,
  emptyBodySchema,
  listSchema,
  createZoneSchema,
  updateZoneSchema,
  createLocationSchema,
  updateLocationSchema,
  createRouteSchema,
  updateRouteSchema,
  createRateSchema,
  updateRateSchema,
  updateSettingsSchema,
  quoteSchema,
  createUserSchema,
  updateUserSchema,
  resetPasswordSchema
};
