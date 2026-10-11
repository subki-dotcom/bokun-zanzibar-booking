const AppError = require("../../utils/AppError");
const { toDecimal, toDecimal128, moneyString } = require("../../utils/money");
const { withTransaction } = require("../db/connection");
const { recordTransferAudit } = require("./audit");
const { BOOKING_STATUS, PAYMENT_STATUS, DEFAULT_MAX_ADVANCE_DAYS } = require("../models");
const { QUOTE_STATUS } = require("../pricing/engine");
const {
  REFERENCE_PATTERN,
  generateBookingReference,
  generateAccessNonce,
  bookingAccessToken,
  tokenMatches,
  requestFingerprint,
  maskEmail,
  maskPhone
} = require("../security/bookingAccess");

// Zanzibar is UTC+3 all year (no daylight saving).
const ZANZIBAR_OFFSET_MINUTES = 3 * 60;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

const notFound = () => new AppError("Booking not found", 404, "TRANSFER_BOOKING_NOT_FOUND");

// "2026-11-02" + "14:30" in Zanzibar time → the UTC instant, or null when the date does not exist.
const zanzibarInstant = (localDate, localTime) => {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(localDate || ""));
  const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(localTime || ""));
  if (!date || !time) return null;
  const [year, month, day] = date.slice(1).map(Number);
  const utc = Date.UTC(year, month - 1, day, Number(time[1]), Number(time[2])) - ZANZIBAR_OFFSET_MINUTES * 60000;
  const check = new Date(utc + ZANZIBAR_OFFSET_MINUTES * 60000);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return new Date(utc);
};

const scheduleFor = (input, now, maxAdvanceDays = DEFAULT_MAX_ADVANCE_DAYS) => {
  const horizon = maxAdvanceDays * 86400000;
  const tooFar = `Bookings can be made up to ${maxAdvanceDays} days ahead`;
  const invalid = (message, field) => new AppError(message, 422, "TRANSFER_INVALID_SCHEDULE", { field });
  const outbound = zanzibarInstant(input.travelDate, input.travelTime);
  if (!outbound) throw invalid("Enter a valid travel date and time", "travelDate");
  if (outbound <= now) throw invalid("The travel date and time must be in the future", "travelDate");
  if (outbound.getTime() - now.getTime() > horizon) throw invalid(tooFar, "travelDate");
  const schedule = { outbound };
  if (input.tripType === "ROUND_TRIP") {
    const back = zanzibarInstant(input.returnDate, input.returnTime);
    if (!back) throw invalid("Enter a valid return date and time", "returnDate");
    if (back <= outbound) throw invalid("The return must be after the outbound transfer", "returnDate");
    if (back.getTime() - now.getTime() > horizon) throw invalid(tooFar, "returnDate");
    schedule.back = back;
  }
  return schedule;
};

const sameMoney = (left, right) => {
  try {
    return toDecimal(left).equals(toDecimal(right));
  } catch (_error) {
    return false;
  }
};

const STATUS_FOR_QUOTE = {
  [QUOTE_STATUS.PRICED]: BOOKING_STATUS.AWAITING_PAYMENT,
  [QUOTE_STATUS.QUOTE_REQUIRED]: BOOKING_STATUS.QUOTE_REQUESTED
};

// What a customer may see about their own booking: no internal ids, notes or full contact details.
const publicBookingView = (booking) => ({
  reference: booking.reference,
  status: booking.status,
  paymentStatus: booking.paymentStatus,
  paymentArrangement: booking.paymentArrangement || "ONLINE",
  tripType: booking.tripType,
  legs: booking.legs.map((leg) => ({
    direction: leg.direction,
    pickupLocationName: leg.pickupLocationName,
    dropoffLocationName: leg.dropoffLocationName,
    localDate: leg.localDate,
    localTime: leg.localTime,
    price: leg.price === null || leg.price === undefined ? null : moneyString(leg.price)
  })),
  pickupAddress: booking.pickupAddress || "",
  dropoffAddress: booking.dropoffAddress || "",
  passengers: { adults: booking.passengers.adults, children: booking.passengers.children, infants: booking.passengers.infants },
  luggage: { largeBags: booking.luggage?.largeBags || 0, smallBags: booking.luggage?.smallBags || 0, notes: booking.luggage?.notes || "" },
  flightNumber: booking.flightNumber || "",
  customer: {
    fullName: booking.customer.fullName,
    email: maskEmail(booking.customer.email),
    phone: maskPhone(booking.customer.phone),
    whatsapp: Boolean(booking.customer.whatsapp)
  },
  specialRequests: booking.specialRequests || "",
  pricing: {
    status: booking.pricing.status,
    currency: booking.pricing.currency,
    total: booking.pricing.total === null || booking.pricing.total === undefined ? null : moneyString(booking.pricing.total),
    basis: booking.pricing.basis
  },
  timeline: (booking.statusHistory || []).map((entry) => ({ status: entry.status, at: entry.at })),
  createdAt: booking.createdAt
});

const publicQuoteView = (quote) => ({
  status: quote.status,
  tripType: quote.tripType,
  currency: quote.currency,
  total: quote.total,
  passengers: { adults: quote.passengers.adults, children: quote.passengers.children, infants: quote.passengers.infants },
  legs: quote.legs.map((leg) => ({ direction: leg.direction, price: leg.price, status: leg.status, basis: leg.basis })),
  reasons: quote.reasons
});

const createTransferBookingService = ({ getStore, pricing, accessSecret, now = () => new Date() }) => {
  const tokenFor = (booking) => bookingAccessToken({ secret: accessSecret(), bookingId: String(booking._id), nonce: booking.accessNonce });

  const listPublicLocations = async () => {
    const { models } = await getStore();
    const zones = await models.Zone.find({ active: true }, { _id: 1 }).lean();
    const locations = await models.Location.find({ active: true, zoneId: { $in: zones.map((zone) => zone._id) } }, { name: 1, type: 1, sortOrder: 1 })
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    return locations.map((location) => ({ id: String(location._id), name: location.name, type: location.type }));
  };

  const quote = async (input) => publicQuoteView(await pricing.quote(input));

  // Answers a repeated submission with the booking it already created. Staff callers also get the internal id.
  const replay = (existing, fingerprint, origin = null) => {
    if (existing.requestFingerprint !== fingerprint) {
      throw new AppError("This Idempotency-Key was already used for a different booking.", 409, "TRANSFER_IDEMPOTENCY_KEY_REUSED");
    }
    return { replayed: true, reference: existing.reference, accessToken: tokenFor(existing), booking: publicBookingView(existing), ...(origin ? { id: String(existing._id) } : {}) };
  };

  const findByKey = (models, idempotencyKey) =>
    models.Booking.findOne({ idempotencyKey }).select("+idempotencyKey +requestFingerprint +accessNonce").lean();

  // origin is set for bookings entered by Transfer Admin staff (WhatsApp, phone, …); website bookings have none.
  const createBooking = async ({ input, idempotencyKey, context, origin = null }) => {
    if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey || ""))) {
      throw new AppError("An Idempotency-Key header (16–128 letters, numbers, - or _) is required.", 400, "TRANSFER_IDEMPOTENCY_KEY_REQUIRED");
    }
    const store = await getStore();
    const { models } = store;
    const fingerprint = requestFingerprint(origin ? { input, manualChannel: origin.manualChannel, by: origin.actor.id } : input);
    const existing = await findByKey(models, idempotencyKey);
    if (existing) return replay(existing, fingerprint, origin);

    const at = now();
    const settings = (await models.Settings.findOne({ key: "pricing" }, { maxAdvanceDays: 1 }).lean()) || {};
    const schedule = scheduleFor(input, at, settings.maxAdvanceDays || DEFAULT_MAX_ADVANCE_DAYS);
    const priced = await pricing.quote({
      tripType: input.tripType,
      pickupLocationId: input.pickupLocationId,
      dropoffLocationId: input.dropoffLocationId,
      passengers: input.passengers
    });

    // The customer confirms the price they saw; if the server's price differs, nothing is booked.
    const expected = input.expectedTotal ?? null;
    const unchanged = priced.status === QUOTE_STATUS.PRICED ? expected !== null && sameMoney(expected, priced.total) : expected === null;
    if (!unchanged) {
      throw new AppError("The price has changed. Please review the new price before booking.", 409, "TRANSFER_PRICE_CHANGED", { quote: publicQuoteView(priced) });
    }

    const [pickup, dropoff] = await Promise.all([
      models.Location.findById(input.pickupLocationId, { name: 1 }).lean(),
      models.Location.findById(input.dropoffLocationId, { name: 1 }).lean()
    ]);
    const legs = priced.legs.map((leg) => {
      const outbound = leg.direction === "OUTBOUND";
      const when = outbound ? schedule.outbound : schedule.back;
      return {
        direction: leg.direction,
        pickupLocationId: outbound ? input.pickupLocationId : input.dropoffLocationId,
        pickupLocationName: outbound ? pickup.name : dropoff.name,
        pickupZoneCode: leg.fromZone.code,
        dropoffLocationId: outbound ? input.dropoffLocationId : input.pickupLocationId,
        dropoffLocationName: outbound ? dropoff.name : pickup.name,
        dropoffZoneCode: leg.toZone.code,
        localDate: outbound ? input.travelDate : input.returnDate,
        localTime: outbound ? input.travelTime : input.returnTime,
        pickupAt: when,
        routeId: leg.routeId,
        rateId: leg.rateId,
        tier: leg.tier || undefined,
        price: leg.price === null ? null : toDecimal128(leg.price),
        priceStatus: leg.status,
        priceReason: leg.reason
      };
    });
    // Staff entering a booking by hand are warned about an existing booking for the same customer, pickup and time.
    if (origin && !origin.allowDuplicate) {
      const duplicate = await models.Booking.findOne({
        status: { $nin: [BOOKING_STATUS.REJECTED, BOOKING_STATUS.CANCELLED] },
        "legs.0.pickupAt": schedule.outbound,
        "legs.0.pickupLocationId": input.pickupLocationId,
        $or: [{ "customer.email": String(input.customer.email).toLowerCase() }, { "customer.phone": input.customer.phone }]
      }, { reference: 1 }).lean();
      // A simultaneous retry of this same submission may have just created the booking: that is a replay, not a duplicate.
      const sameSubmission = duplicate ? await findByKey(models, idempotencyKey) : null;
      if (sameSubmission) return replay(sameSubmission, fingerprint, origin);
      if (duplicate) {
        throw new AppError(`Booking ${duplicate.reference} already exists for this customer, pickup and time.`, 409, "TRANSFER_POSSIBLE_DUPLICATE", { reference: duplicate.reference, id: String(duplicate._id) });
      }
    }

    const status = STATUS_FOR_QUOTE[priced.status];
    const document = {
      source: origin ? "MANUAL" : "WEBSITE",
      manualChannel: origin ? origin.manualChannel : "",
      createdBy: origin ? { id: origin.actor.id, email: origin.actor.email } : { id: "", email: "" },
      status,
      paymentStatus: PAYMENT_STATUS.UNPAID,
      tripType: input.tripType,
      legs,
      pickupAddress: input.pickupAddress || "",
      dropoffAddress: input.dropoffAddress || "",
      passengers: { adults: priced.passengers.adults, children: priced.passengers.children, infants: priced.passengers.infants, priced: priced.passengers.priced, capacity: priced.passengers.capacity },
      luggage: input.luggage || {},
      flightNumber: input.flightNumber || "",
      customer: input.customer,
      specialRequests: input.specialRequests || "",
      pricing: {
        status: priced.status,
        currency: priced.currency,
        total: priced.total === null ? null : toDecimal128(priced.total),
        basis: "PER_VEHICLE",
        infantPricing: priced.passengers.infantPricing,
        reasons: priced.reasons,
        quotedAt: at
      },
      pricingHistory: [
        {
          source: "ENGINE",
          status: priced.status,
          total: priced.total === null ? null : toDecimal128(priced.total),
          legs: priced.legs.map((leg) => ({ direction: leg.direction, price: leg.price === null ? null : toDecimal128(leg.price) })),
          at,
          by: origin ? origin.actor.email : "customer",
          reason: ""
        }
      ],
      statusHistory: [
        origin
          ? { status, at, by: origin.actor.email, note: `Entered by staff (${origin.manualChannel})${origin.allowDuplicate ? ` despite a possible duplicate: ${origin.duplicateReason}` : ""}` }
          : { status, at, by: "customer", note: "Submitted on the website" }
      ],
      idempotencyKey,
      requestFingerprint: fingerprint,
      accessNonce: generateAccessNonce()
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const created = await withTransaction(store, async (session) => {
          const [booking] = await models.Booking.create([{ ...document, reference: generateBookingReference() }], session ? { session } : {});
          await recordTransferAudit(
            models,
            { actor: origin ? origin.actor : { role: "customer", email: input.customer.email }, action: origin ? "booking.created_manually" : "booking.created", reason: origin?.allowDuplicate ? `possible duplicate accepted: ${origin.duplicateReason}` : "", entityType: "TransferBooking", entityId: booking._id, after: { ...booking.toObject(), accessNonce: undefined, idempotencyKey: undefined, requestFingerprint: undefined }, context },
            session
          );
          return booking.toObject();
        });
        return { replayed: false, reference: created.reference, accessToken: tokenFor(created), booking: publicBookingView(created), ...(origin ? { id: String(created._id) } : {}) };
      } catch (error) {
        if (error?.code !== 11000) throw error;
        // A concurrent request with the same key won the race: answer with its booking.
        if (error.keyPattern?.idempotencyKey) {
          const winner = await findByKey(models, idempotencyKey);
          if (winner) return replay(winner, fingerprint, origin);
        }
        // Otherwise the random reference collided; try another one.
      }
    }
    throw new AppError("Could not create the booking. Please try again.", 503, "TRANSFER_BOOKING_RETRY");
  };

  // The reference alone never opens a booking: the access token must match too. Both failures look the same.
  const getBooking = async ({ reference, accessToken }) => {
    if (!REFERENCE_PATTERN.test(String(reference || "")) || !accessToken) throw notFound();
    const { models } = await getStore();
    const booking = await models.Booking.findOne({ reference }).select("+accessNonce").lean();
    const expected = booking ? tokenFor(booking) : "invalid";
    if (!tokenMatches(accessToken, expected) || !booking) throw notFound();
    return publicBookingView(booking);
  };

  return { listPublicLocations, quote, createBooking, getBooking, tokenFor };
};

module.exports = { zanzibarInstant, scheduleFor, publicBookingView, createTransferBookingService };
