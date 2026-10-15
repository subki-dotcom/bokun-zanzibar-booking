const crypto = require("crypto");
const mongoose = require("mongoose");
const AppError = require("../../utils/AppError");
const { toDecimal, moneyString } = require("../../utils/money");
const { withTransaction } = require("../db/connection");
const { recordTransferAudit } = require("./audit");
const {
  BOOKING_STATUS,
  PAYMENT_STATUS,
  PAYMENT_ALERTS,
  TRANSFER_CURRENCY,
  TRANSFER_PAYMENT_STATUS: PAY,
  TRANSFER_PAYMENT_OUTCOME: OUTCOME
} = require("../models");
const { STATES } = require("../payments/pesapalGateway");

const MAX_CHECKS_KEPT = 30;
const SYSTEM_ACTOR = Object.freeze({ id: "", email: "pesapal", role: "system" });

const paymentNotFound = () => new AppError("Payment not found", 404, "TRANSFER_PAYMENT_NOT_FOUND");
const refuse = (message, code, details) => new AppError(message, 409, code, details);

const sameMoney = (left, right) => {
  try {
    return toDecimal(left).equals(toDecimal(right));
  } catch (_error) {
    return false;
  }
};

// Our id for a Pesapal order: the booking reference plus a random suffix, so every attempt has its own id.
const newMerchantReference = (reference) => `${reference}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

// Why a verified payment cannot confirm its booking, or "" when it can.
const unappliedReason = (booking, payment, status) => {
  if (booking.paymentStatus === PAYMENT_STATUS.PAID) return "The booking was already paid by another payment.";
  if (booking.status !== BOOKING_STATUS.AWAITING_PAYMENT) return `The booking is ${booking.status.toLowerCase().replace(/_/g, " ")}.`;
  if (status.currency !== payment.currency) return `Pesapal reports ${status.currency || "no currency"}, the booking is in ${payment.currency}.`;
  if (!sameMoney(status.amount, payment.amount)) return `Pesapal reports ${status.amount || "no amount"} ${status.currency}, the booking costs ${moneyString(payment.amount)}.`;
  return "";
};

const paymentView = (payment) => ({
  id: String(payment._id),
  bookingId: String(payment.bookingId),
  bookingReference: payment.bookingReference,
  provider: payment.provider,
  merchantReference: payment.merchantReference,
  orderTrackingId: payment.orderTrackingId || "",
  amount: moneyString(payment.amount),
  currency: payment.currency,
  status: payment.status,
  outcome: payment.outcome || "",
  outcomeReason: payment.outcomeReason || "",
  failureReason: payment.failureReason || "",
  providerStatus: payment.providerStatus || "",
  paidAmount: payment.paidAmount || "",
  paidCurrency: payment.paidCurrency || "",
  paymentMethod: payment.paymentMethod || "",
  confirmationCode: payment.confirmationCode || "",
  verifiedAt: payment.verifiedAt,
  lastCheckedAt: payment.lastCheckedAt,
  checks: payment.checks || [],
  createdAt: payment.createdAt
});

// Online payment for transfer bookings. A booking becomes CONFIRMED and PAID only here, and only from Pesapal's
// own transaction status (fetched by the server), never from what the customer's browser reports.
const createTransferPaymentService = ({ getStore, bookings, gateway, now = () => new Date() }) => {
  const available = () => gateway.configured();

  // Whether a customer may start paying this booking now.
  const payableProblem = (booking, at) => {
    if (booking.paymentStatus !== PAYMENT_STATUS.UNPAID) return ["This booking is already paid.", "TRANSFER_ALREADY_PAID"];
    if (booking.status !== BOOKING_STATUS.AWAITING_PAYMENT) {
      return booking.status === BOOKING_STATUS.QUOTE_REQUESTED
        ? ["Our team has not priced this transfer yet. You will receive a link to pay once it is priced.", "TRANSFER_NOT_PRICED"]
        : [`This booking is ${booking.status.toLowerCase().replace(/_/g, " ")} and cannot be paid.`, "TRANSFER_NOT_PAYABLE"];
    }
    if (booking.pricing.status !== "PRICED" || !booking.pricing.total || toDecimal(booking.pricing.total).lessThanOrEqualTo(0)) {
      return ["This booking has no price yet.", "TRANSFER_NOT_PRICED"];
    }
    const firstPickup = Math.min(...booking.legs.map((leg) => new Date(leg.pickupAt).getTime()));
    if (firstPickup <= at.getTime()) return ["The pickup time has passed, so this booking can no longer be paid online.", "TRANSFER_PAYMENT_CLOSED"];
    return null;
  };

  const canPay = (booking) => available() && !payableProblem(booking, now());

  // Opens a Pesapal checkout for the booking's exact server price. The payment record is saved before Pesapal is
  // called, so a notification can never arrive for an attempt we do not know.
  const startPayment = async ({ reference, accessToken, context }) => {
    const booking = await bookings.loadForCustomer({ reference, accessToken });
    if (!available()) throw new AppError("Online payment is not available at the moment. Nothing has been charged.", 503, "TRANSFER_PAYMENT_UNAVAILABLE");
    const problem = payableProblem(booking, now());
    if (problem) throw refuse(problem[0], problem[1], { status: booking.status, paymentStatus: booking.paymentStatus });

    const { models } = await getStore();
    const customer = { role: "customer", email: booking.customer.email };
    const payment = await models.Payment.create({
      bookingId: booking._id,
      bookingReference: booking.reference,
      merchantReference: newMerchantReference(booking.reference),
      amount: booking.pricing.total,
      currency: booking.pricing.currency || TRANSFER_CURRENCY
    });
    let order;
    try {
      order = await gateway.submitOrder({
        merchantReference: payment.merchantReference,
        amount: moneyString(payment.amount),
        currency: payment.currency,
        description: `Zanzibar transfer ${booking.reference}`,
        customer: booking.customer
      });
    } catch (error) {
      await models.Payment.updateOne({ _id: payment._id }, { $set: { status: PAY.FAILED, failureReason: String(error.message || "Pesapal order failed").slice(0, 300) } });
      await recordTransferAudit(models, { actor: customer, action: "payment.start_failed", entityType: "TransferBooking", entityId: booking._id, after: { merchantReference: payment.merchantReference, code: error.code || "" }, context });
      throw error;
    }
    await models.Payment.updateOne({ _id: payment._id }, { $set: { orderTrackingId: order.orderTrackingId } });
    await recordTransferAudit(models, {
      actor: customer,
      action: "payment.started",
      entityType: "TransferBooking",
      entityId: booking._id,
      after: { merchantReference: payment.merchantReference, orderTrackingId: order.orderTrackingId, amount: moneyString(payment.amount), currency: payment.currency },
      context
    });
    return { reference: booking.reference, merchantReference: payment.merchantReference, redirectUrl: order.redirectUrl };
  };

  // Applies a PAID answer: confirms the booking when the money matches an open booking, otherwise keeps the money
  // on record as needing a refund. Runs once per payment even when the return page and the IPN arrive together.
  const applyPaid = async ({ store, payment, status, source, actor, context, at }) =>
    withTransaction(store, async (session) => {
      const options = session ? { session } : {};
      const scoped = (query) => (session ? query.session(session) : query);
      const claimed = await scoped(
        store.models.Payment.findOneAndUpdate(
          { _id: payment._id, status: { $ne: PAY.PAID }, outcome: OUTCOME.NONE },
          { $set: { status: PAY.PAID, verifiedAt: at, paidAmount: status.amount, paidCurrency: status.currency, paymentMethod: status.paymentMethod, confirmationCode: status.confirmationCode, failureReason: "" } },
          { new: true }
        ).lean()
      );
      if (!claimed) return null;
      const booking = await scoped(store.models.Booking.findById(payment.bookingId).lean());
      const reason = booking ? unappliedReason(booking, payment, status) : "The booking no longer exists.";
      const evidence = { merchantReference: payment.merchantReference, orderTrackingId: payment.orderTrackingId, amount: status.amount, currency: status.currency, confirmationCode: status.confirmationCode, paymentMethod: status.paymentMethod, source };
      if (!reason) {
        const confirmed = await scoped(
          store.models.Booking.findOneAndUpdate(
            { _id: booking._id, status: BOOKING_STATUS.AWAITING_PAYMENT, paymentStatus: PAYMENT_STATUS.UNPAID },
            {
              $set: { status: BOOKING_STATUS.CONFIRMED, paymentStatus: PAYMENT_STATUS.PAID },
              $push: { statusHistory: { status: BOOKING_STATUS.CONFIRMED, at, by: "pesapal", note: `Paid online with Pesapal (${status.confirmationCode || payment.merchantReference})` } }
            },
            { new: true, verifiedPayment: true }
          ).lean()
        );
        if (confirmed) {
          await store.models.Payment.updateOne({ _id: payment._id }, { $set: { outcome: OUTCOME.APPLIED } }, options);
          await recordTransferAudit(store.models, { actor, action: "payment.verified", entityType: "TransferBooking", entityId: booking._id, before: { status: booking.status, paymentStatus: booking.paymentStatus }, after: { status: confirmed.status, paymentStatus: confirmed.paymentStatus, ...evidence }, context }, session);
          return { outcome: OUTCOME.APPLIED };
        }
      }
      const why = reason || "The booking changed while the payment was being verified.";
      await store.models.Payment.updateOne({ _id: payment._id }, { $set: { outcome: OUTCOME.NEEDS_REFUND, outcomeReason: why } }, options);
      if (booking) await store.models.Booking.updateOne({ _id: booking._id }, { $set: { paymentAlert: PAYMENT_ALERTS.NEEDS_REFUND } }, options);
      await recordTransferAudit(store.models, { actor, action: "payment.needs_refund", entityType: "TransferBooking", entityId: payment.bookingId, after: { ...evidence, reason: why }, reason: why, context }, session);
      return { outcome: OUTCOME.NEEDS_REFUND };
    });

  // Asks Pesapal for the transaction and records what it says. Safe to call any number of times.
  const verify = async ({ orderTrackingId, merchantReference = "", source, actor = SYSTEM_ACTOR, context = {} }) => {
    const trackingId = String(orderTrackingId || "").trim();
    if (!trackingId || trackingId.length > 100) throw paymentNotFound();
    const store = await getStore();
    const { models } = store;
    const payment = await models.Payment.findOne({ orderTrackingId: trackingId }).lean();
    if (!payment || (merchantReference && merchantReference !== payment.merchantReference)) throw paymentNotFound();

    const status = await gateway.transactionStatus(trackingId);
    const at = now();
    const check = { at, source, status: status.status, statusCode: status.statusCode, by: actor.email };
    await models.Payment.updateOne(
      { _id: payment._id },
      { $set: { lastCheckedAt: at, providerStatus: status.status, providerStatusCode: status.statusCode }, $push: { checks: { $each: [check], $slice: -MAX_CHECKS_KEPT } } }
    );
    if (status.merchantReference && status.merchantReference !== payment.merchantReference) {
      await recordTransferAudit(models, { actor, action: "payment.reference_mismatch", entityType: "TransferBooking", entityId: payment.bookingId, after: { expected: payment.merchantReference, reported: status.merchantReference, orderTrackingId: trackingId }, context });
      throw refuse("Pesapal reported a different order for this payment. It was not applied.", "TRANSFER_PAYMENT_MISMATCH");
    }

    if (status.state === STATES.PAID) {
      await applyPaid({ store, payment, status, source, actor, context, at });
    } else if (status.state === STATES.REVERSED && payment.status === PAY.PAID) {
      const reversed = await models.Payment.findOneAndUpdate({ _id: payment._id, status: PAY.PAID }, { $set: { status: PAY.REVERSED } }, { new: true }).lean();
      if (reversed) {
        await models.Booking.updateOne({ _id: payment.bookingId }, { $set: { paymentAlert: PAYMENT_ALERTS.PAYMENT_REVERSED } });
        await recordTransferAudit(models, { actor, action: "payment.reversed", entityType: "TransferBooking", entityId: payment.bookingId, after: { merchantReference: payment.merchantReference, orderTrackingId: trackingId, providerStatus: status.status }, context });
      }
    } else if ([STATES.FAILED, STATES.CANCELLED, STATES.REVERSED].includes(status.state) && payment.status === PAY.PENDING) {
      // Not final: Pesapal lets the customer try again on the same order, and a later PAID answer still applies.
      await models.Payment.updateOne({ _id: payment._id, status: PAY.PENDING }, { $set: { status: status.state === STATES.CANCELLED ? PAY.CANCELLED : PAY.FAILED, failureReason: status.status } });
    }

    const [latest, booking] = await Promise.all([models.Payment.findById(payment._id).lean(), models.Booking.findById(payment.bookingId, { reference: 1, status: 1, paymentStatus: 1 }).lean()]);
    return {
      reference: payment.bookingReference,
      payment: { status: latest.status, outcome: latest.outcome || "" },
      booking: booking ? { status: booking.status, paymentStatus: booking.paymentStatus } : null
    };
  };

  const validId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

  const listForBooking = async ({ bookingId }) => {
    if (!validId(bookingId)) throw new AppError("Booking not found", 404, "TRANSFER_BOOKING_NOT_FOUND");
    const { models } = await getStore();
    const payments = await models.Payment.find({ bookingId }).sort({ createdAt: -1 }).lean();
    return payments.map(paymentView);
  };

  // Staff can ask Pesapal again; they can never mark a payment paid themselves.
  const recheck = async ({ bookingId, paymentId, actor, context }) => {
    if (!validId(bookingId) || !validId(paymentId)) throw paymentNotFound();
    const { models } = await getStore();
    const payment = await models.Payment.findOne({ _id: paymentId, bookingId }).lean();
    if (!payment) throw paymentNotFound();
    if (!payment.orderTrackingId) throw refuse("This attempt never reached Pesapal, so there is nothing to check.", "TRANSFER_PAYMENT_NOT_SUBMITTED");
    await verify({ orderTrackingId: payment.orderTrackingId, source: "ADMIN", actor, context });
    return paymentView(await models.Payment.findById(payment._id).lean());
  };

  return { available, canPay, startPayment, verify, listForBooking, recheck };
};

module.exports = { createTransferPaymentService, paymentView, unappliedReason, newMerchantReference };
