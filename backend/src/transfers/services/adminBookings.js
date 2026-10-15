const mongoose = require("mongoose");
const AppError = require("../../utils/AppError");
const { toDecimal, toDecimal128, moneyString, add } = require("../../utils/money");
const { withTransaction } = require("../db/connection");
const { recordTransferAudit } = require("./audit");
const { BOOKING_STATUS, PAYMENT_STATUS, PAYMENT_ARRANGEMENTS } = require("../models");
const { TRANSFER_PERMISSIONS } = require("../security/permissions");

const ZANZIBAR_OFFSET_MS = 3 * 3600000;
const MAX_PRICE = "1000000";
const OPEN_STATUSES = [BOOKING_STATUS.QUOTE_REQUESTED, BOOKING_STATUS.AWAITING_PAYMENT];

const money = (value) => (value === null || value === undefined ? null : moneyString(value));
const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const notFound = () => new AppError("Booking not found", 404, "TRANSFER_BOOKING_NOT_FOUND");
const validId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const legView = (leg) => ({
  direction: leg.direction,
  pickupLocationId: String(leg.pickupLocationId),
  pickupLocationName: leg.pickupLocationName,
  pickupZoneCode: leg.pickupZoneCode,
  dropoffLocationId: String(leg.dropoffLocationId),
  dropoffLocationName: leg.dropoffLocationName,
  dropoffZoneCode: leg.dropoffZoneCode,
  localDate: leg.localDate,
  localTime: leg.localTime,
  pickupAt: leg.pickupAt,
  routeId: leg.routeId ? String(leg.routeId) : null,
  rateId: leg.rateId ? String(leg.rateId) : null,
  tier: leg.tier?.minPassengers ? leg.tier : null,
  price: money(leg.price),
  priceStatus: leg.priceStatus,
  priceReason: leg.priceReason || ""
});

const summaryView = (booking) => ({
  id: String(booking._id),
  reference: booking.reference,
  status: booking.status,
  paymentStatus: booking.paymentStatus,
  paymentArrangement: booking.paymentArrangement || PAYMENT_ARRANGEMENTS.ONLINE,
  paymentAlert: booking.paymentAlert || "",
  source: booking.source,
  manualChannel: booking.manualChannel || "",
  tripType: booking.tripType,
  firstLeg: booking.legs[0] ? legView(booking.legs[0]) : null,
  legsCount: booking.legs.length,
  passengers: booking.passengers,
  customer: { fullName: booking.customer.fullName, email: booking.customer.email, phone: booking.customer.phone, whatsapp: Boolean(booking.customer.whatsapp) },
  pricing: { status: booking.pricing.status, currency: booking.pricing.currency, total: money(booking.pricing.total) },
  createdAt: booking.createdAt
});

const detailView = (booking) => ({
  ...summaryView(booking),
  legs: booking.legs.map(legView),
  pickupAddress: booking.pickupAddress || "",
  dropoffAddress: booking.dropoffAddress || "",
  luggage: booking.luggage || {},
  flightNumber: booking.flightNumber || "",
  specialRequests: booking.specialRequests || "",
  createdBy: booking.createdBy || null,
  pricing: {
    status: booking.pricing.status,
    currency: booking.pricing.currency,
    total: money(booking.pricing.total),
    basis: booking.pricing.basis,
    infantPricing: booking.pricing.infantPricing,
    reasons: booking.pricing.reasons || [],
    quotedAt: booking.pricing.quotedAt
  },
  pricingHistory: (booking.pricingHistory || []).map((entry) => ({
    source: entry.source,
    status: entry.status,
    total: money(entry.total),
    legs: (entry.legs || []).map((leg) => ({ direction: leg.direction, price: money(leg.price) })),
    at: entry.at,
    by: entry.by,
    reason: entry.reason || ""
  })),
  statusHistory: booking.statusHistory || [],
  updatedAt: booking.updatedAt
});

// Start of "today" in Zanzibar, as a UTC instant.
const zanzibarDayStart = (now) => {
  const local = new Date(now.getTime() + ZANZIBAR_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - ZANZIBAR_OFFSET_MS);
};

const createTransferAdminBookingService = ({ getStore, bookings, now = () => new Date() }) => {
  const list = async ({ query = {} }) => {
    const { models } = await getStore();
    const filter = {};
    const statuses = String(query.status || "").split(",").filter((status) => Object.values(BOOKING_STATUS).includes(status));
    if (statuses.length) filter.status = { $in: statuses };
    if (Object.values(PAYMENT_STATUS).includes(query.paymentStatus)) filter.paymentStatus = query.paymentStatus;
    if (["WEBSITE", "MANUAL"].includes(query.source)) filter.source = query.source;
    if (query.paymentAlert === "any") filter.paymentAlert = { $nin: ["", null] };
    const dateField = query.dateField === "created" ? "createdAt" : "legs.0.pickupAt";
    const range = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(query.from || "")) range.$gte = new Date(`${query.from}T00:00:00+03:00`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(query.to || "")) range.$lt = new Date(new Date(`${query.to}T00:00:00+03:00`).getTime() + 86400000);
    if (Object.keys(range).length) filter[dateField] = range;
    const search = String(query.search || "").trim().slice(0, 100);
    if (search) {
      const pattern = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ reference: pattern }, { "customer.fullName": pattern }, { "customer.email": pattern }, { "customer.phone": pattern }, { flightNumber: pattern }];
    }
    const sortField = query.sort === "pickup" ? { "legs.0.pickupAt": 1, _id: 1 } : { createdAt: -1, _id: -1 };
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const page = Math.max(1, Number(query.page) || 1);
    const [items, total] = await Promise.all([
      models.Booking.find(filter).sort(sortField).skip((page - 1) * limit).limit(limit).lean(),
      models.Booking.countDocuments(filter)
    ]);
    return { items: items.map(summaryView), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  };

  const get = async ({ bookingId, actor }) => {
    if (!validId(bookingId)) throw notFound();
    const { models } = await getStore();
    const booking = await models.Booking.findById(bookingId).lean();
    if (!booking) throw notFound();
    const view = detailView(booking);
    // The full audit trail is shown only to users allowed to read audit logs.
    if (actor.permissions.includes(TRANSFER_PERMISSIONS.AUDIT_VIEW)) {
      const entries = await models.AuditLog.find({ entityType: "TransferBooking", entityId: String(booking._id) }).sort({ createdAt: 1, _id: 1 }).lean();
      view.audit = entries.map((entry) => ({ id: String(entry._id), action: entry.action, actorEmail: entry.actorEmail, actorRole: entry.actorRole, reason: entry.reason, createdAt: entry.createdAt }));
    }
    return view;
  };

  // Applies a status change only if the booking is still in one of the expected states, so two admins acting
  // at once cannot both succeed (for example, approving and rejecting the same booking).
  const transition = async ({ actor, bookingId, from, context, action, reason, build }) => {
    if (!validId(bookingId)) throw notFound();
    const store = await getStore();
    return withTransaction(store, async (session) => {
      const scoped = (query) => (session ? query.session(session) : query);
      const before = await scoped(store.models.Booking.findById(bookingId).lean());
      if (!before) throw notFound();
      if (!from.includes(before.status) || before.paymentStatus !== PAYMENT_STATUS.UNPAID) {
        throw new AppError(`This booking is ${before.status.toLowerCase().replace(/_/g, " ")}${before.paymentStatus !== PAYMENT_STATUS.UNPAID ? " and paid" : ""}; that action is not available.`, 409, "TRANSFER_INVALID_TRANSITION", { status: before.status, paymentStatus: before.paymentStatus });
      }
      const at = now();
      const { set, status, note, pricingEntry } = build(before, at);
      const update = {
        $set: { ...set, status },
        $push: { statusHistory: { status, at, by: actor.email, note } }
      };
      if (pricingEntry) update.$push.pricingHistory = pricingEntry;
      const after = await scoped(
        store.models.Booking.findOneAndUpdate({ _id: before._id, status: before.status, paymentStatus: PAYMENT_STATUS.UNPAID }, update, { new: true }).lean()
      );
      if (!after) throw new AppError("This booking was changed by someone else. Refresh and try again.", 409, "TRANSFER_CONCURRENT_UPDATE");
      await recordTransferAudit(store.models, { actor, action, entityType: "TransferBooking", entityId: before._id, before: { status: before.status, pricing: before.pricing }, after: { status: after.status, pricing: after.pricing, paymentArrangement: after.paymentArrangement }, reason, context }, session);
      return detailView(after);
    });
  };

  // Sets the price of a quote request. The engine price (none) stays in the pricing history.
  const setQuote = async ({ actor, bookingId, input, context }) =>
    transition({
      actor,
      bookingId,
      context,
      from: [BOOKING_STATUS.QUOTE_REQUESTED],
      action: "booking.quoted",
      reason: input.reason,
      build: (before, at) => {
        const byDirection = new Map(input.legs.map((leg) => [leg.direction, leg.price]));
        if (byDirection.size !== input.legs.length || before.legs.some((leg) => !byDirection.has(leg.direction)) || byDirection.size !== before.legs.length) {
          throw new AppError("Give one price for each leg of this booking.", 422, "TRANSFER_QUOTE_LEGS_MISMATCH");
        }
        const prices = before.legs.map((leg) => {
          const price = toDecimal(byDirection.get(leg.direction), { allowNegative: false, field: "price" });
          if (price.lessThanOrEqualTo(0) || price.greaterThan(MAX_PRICE) || price.decimalPlaces() > 2) {
            throw new AppError("Each price must be greater than 0, at most 1,000,000 and have at most 2 decimals", 422, "TRANSFER_INVALID_PRICE");
          }
          return price.toFixed(2);
        });
        const total = add(...prices);
        const legs = before.legs.map((leg, index) => ({ ...leg, price: toDecimal128(prices[index]), priceStatus: "PRICED", priceReason: "ADMIN_QUOTE" }));
        return {
          status: BOOKING_STATUS.AWAITING_PAYMENT,
          note: `Quoted ${moneyString(total)} ${before.pricing.currency}: ${input.reason}`,
          set: {
            legs,
            "pricing.status": "PRICED",
            "pricing.total": toDecimal128(moneyString(total)),
            "pricing.reasons": [],
            "pricing.quotedAt": at
          },
          pricingEntry: { source: "ADMIN_QUOTE", status: "PRICED", total: toDecimal128(moneyString(total)), legs: before.legs.map((leg, index) => ({ direction: leg.direction, price: toDecimal128(prices[index]) })), at, by: actor.email, reason: input.reason }
        };
      }
    });

  const reject = async ({ actor, bookingId, input, context }) =>
    transition({
      actor,
      bookingId,
      context,
      from: OPEN_STATUSES,
      action: "booking.rejected",
      reason: input.reason,
      build: () => ({ status: BOOKING_STATUS.REJECTED, note: `Rejected: ${input.reason}`, set: {} })
    });

  // The private customer link, for staff to send by WhatsApp or email. Each disclosure is audited.
  const customerLink = async ({ actor, bookingId, context }) => {
    if (!validId(bookingId)) throw notFound();
    const store = await getStore();
    const booking = await store.models.Booking.findById(bookingId).select("+accessNonce").lean();
    if (!booking) throw notFound();
    await recordTransferAudit(store.models, { actor, action: "booking.customer_link_issued", entityType: "TransferBooking", entityId: booking._id, context });
    return { reference: booking.reference, path: `/transfers/booking/${booking.reference}#t=${encodeURIComponent(bookings.tokenFor(booking))}` };
  };

  // Real figures only. Revenue counts verified payments (PAID) only; priced-but-unpaid bookings are reported
  // separately and are never called revenue.
  const dashboard = async () => {
    const { models } = await getStore();
    const at = now();
    const today = zanzibarDayStart(at);
    const week = new Date(at.getTime() + 7 * 86400000);
    const sumTotal = async (match) => {
      const [row] = await models.Booking.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: "$pricing.total" }, count: { $sum: 1 } } }]);
      return { amount: row ? moneyString(row.total) : "0.00", count: row ? row.count : 0 };
    };
    const [byStatus, createdToday, createdLast7Days, upcoming, paidRevenue, awaitingPayment, paymentAlerts] = await Promise.all([
      models.Booking.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      models.Booking.countDocuments({ createdAt: { $gte: today } }),
      models.Booking.countDocuments({ createdAt: { $gte: new Date(today.getTime() - 6 * 86400000) } }),
      models.Booking.find({ status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.AWAITING_PAYMENT] }, legs: { $elemMatch: { pickupAt: { $gte: at, $lt: week } } } })
        .sort({ "legs.0.pickupAt": 1 })
        .limit(10)
        .lean(),
      sumTotal({ paymentStatus: PAYMENT_STATUS.PAID }),
      sumTotal({ status: BOOKING_STATUS.AWAITING_PAYMENT, paymentStatus: PAYMENT_STATUS.UNPAID }),
      // Money received that staff must refund (or a reversed payment) in the Pesapal dashboard.
      models.Booking.countDocuments({ paymentAlert: { $nin: ["", null] } })
    ]);
    const counts = Object.fromEntries(Object.values(BOOKING_STATUS).map((status) => [status, 0]));
    byStatus.forEach((row) => {
      counts[row._id] = row.count;
    });
    return {
      generatedAt: at,
      currency: "USD",
      counts,
      total: Object.values(counts).reduce((sum, value) => sum + value, 0),
      createdToday,
      createdLast7Days,
      paidRevenue,
      awaitingPayment,
      paymentAlerts,
      upcoming: upcoming.map(summaryView)
    };
  };

  // Keeps a record of a request to a retired action (creating a booking, approving cash on arrival).
  const recordRefusedAction = async ({ actor, action, bookingId, context }) => {
    const { models } = await getStore();
    await recordTransferAudit(models, {
      actor,
      action,
      entityType: "TransferBooking",
      entityId: validId(bookingId) ? String(bookingId) : "",
      reason: "Refused: bookings are created only by customers on the website and paid online",
      context
    });
  };

  return { list, get, setQuote, reject, customerLink, dashboard, recordRefusedAction };
};

module.exports = { createTransferAdminBookingService, detailView, summaryView, zanzibarDayStart };
