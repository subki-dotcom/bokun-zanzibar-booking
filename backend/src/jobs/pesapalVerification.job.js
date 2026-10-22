const { env } = require("../config/env");
const logger = require("../config/logger");
const Booking = require("../models/Booking");
const pesapalService = require("../services/payments/pesapal");
const { resolvePesapalPaymentState } = require("../integrations/pesapal/pesapal.utils");

// Safety net for Pesapal payments that no one confirmed: Pesapal's notification (IPN) did not arrive and the guest
// did not come back to the site. Every few minutes the open orders are asked about; a paid one is verified and goes
// on to Bókun and the emails exactly as if the notification had arrived.

const MINUTE = 60 * 1000;
const MAX_CHECKS = 40;
const UNCHECKED_STATUSES = ["initiated", "pending", "processing", "verification_error"];

const state = {
  name: "pesapal_verification",
  enabled: Boolean(env.PESAPAL_VERIFICATION_POLLER_ENABLED),
  running: false,
  intervalSeconds: Math.max(60, Number(env.PESAPAL_VERIFICATION_POLLER_INTERVAL_SECONDS || 120)),
  lastRunAt: "",
  lastSummary: null,
  lastError: ""
};
let timer = null;

// What to do with an order, from Pesapal's answer and its age:
//   "process": paid, failed, cancelled or reversed – run the normal verification (it records the outcome);
//   "wait":    not paid yet and still recent – the guest may still be paying;
//   "expire":  never paid and old – run the normal verification so the booking shows the payment did not go through.
const decideVerification = ({ paymentState = "", ageMs = 0, giveUpAfterMs = 60 * MINUTE } = {}) => {
  if (["paid", "failed", "cancelled", "reversed"].includes(paymentState)) return "process";
  return ageMs >= giveUpAfterMs ? "expire" : "wait";
};

// Open Pesapal orders between a few minutes and two days old, least recently checked first.
const findOpenOrders = (now = Date.now(), limit = 20) =>
  Booking.find({
    paymentMethod: "pesapal",
    paymentStatus: { $in: UNCHECKED_STATUSES },
    bookingStatus: { $nin: ["cancelled", "confirmed"] },
    paymentTransactionId: { $exists: true, $nin: [null, ""] },
    "pendingCheckout.pesapalInitializedAt": {
      $lte: new Date(now - Number(env.PESAPAL_VERIFICATION_MIN_AGE_MINUTES || 3) * MINUTE).toISOString(),
      $gte: new Date(now - 48 * 60 * MINUTE).toISOString()
    },
    // A payment held for review (for example a card amount that does not match) is asked about a few times only.
    "pendingCheckout.verificationPoll.count": { $not: { $gte: MAX_CHECKS } },
    $or: [
      { "pendingCheckout.verificationPoll.at": { $exists: false } },
      { "pendingCheckout.verificationPoll.at": { $lte: new Date(now - 2 * MINUTE).toISOString() } }
    ]
  })
    .sort({ "pendingCheckout.verificationPoll.at": 1, updatedAt: 1 })
    .limit(limit);

const checkOrder = async (booking, requestId) => {
  const orderTrackingId = String(booking.pendingCheckout?.pesapalOrderTrackingId || booking.paymentTransactionId || "").trim();
  const orderMerchantReference = String(booking.pendingCheckout?.pesapalMerchantReference || booking.bookingReference || "");
  await Booking.updateOne(
    { _id: booking._id },
    { $set: { "pendingCheckout.verificationPoll.at": new Date().toISOString() }, $inc: { "pendingCheckout.verificationPoll.count": 1 } }
  );

  // Read-only question first: a guest still on Pesapal's page is left alone.
  const verification = await pesapalService.getTransactionStatus({ orderTrackingId, booking, orderMerchantReference, requestId });
  const paymentState = resolvePesapalPaymentState(verification?.raw || verification, verification?.status);
  const startedAt = Date.parse(String(booking.pendingCheckout?.pesapalInitializedAt || booking.createdAt || ""));
  const decision = decideVerification({
    paymentState,
    ageMs: Number.isFinite(startedAt) ? Date.now() - startedAt : 0,
    giveUpAfterMs: Number(env.PESAPAL_VERIFICATION_GIVE_UP_MINUTES || 60) * MINUTE
  });
  if (decision === "wait") return { reference: booking.bookingReference, decision, paymentState };

  const result = await pesapalService.verifyAndProcessPesapalPayment({
    orderTrackingId,
    orderMerchantReference,
    requestId,
    source: "verification_poller"
  });
  return { reference: booking.bookingReference, decision, paymentState, status: result?.status || "" };
};

const runVerificationCycle = async (trigger = "interval") => {
  if (state.running) return null;
  state.running = true;
  state.lastRunAt = new Date().toISOString();
  const requestId = `pesapal_verification_${Date.now()}`;
  const summary = { checked: 0, processed: 0, waiting: 0, failed: 0, results: [] };
  try {
    const orders = await findOpenOrders(Date.now(), Number(env.PESAPAL_VERIFICATION_POLLER_BATCH_SIZE || 20));
    for (const booking of orders) {
      summary.checked += 1;
      try {
        const outcome = await checkOrder(booking, requestId);
        if (outcome.decision === "wait") summary.waiting += 1;
        else summary.processed += 1;
        summary.results.push(outcome);
      } catch (error) {
        summary.failed += 1;
        logger.warn("Pesapal verification poller could not check an order", {
          requestId,
          bookingReference: booking.bookingReference,
          code: error.code || "",
          error: error.message
        });
      }
    }
    if (summary.checked) {
      logger.info("Pesapal verification cycle finished", {
        trigger,
        checked: summary.checked,
        processed: summary.processed,
        waiting: summary.waiting,
        failed: summary.failed,
        results: summary.results.filter((item) => item.decision !== "wait")
      });
    }
    state.lastSummary = { checked: summary.checked, processed: summary.processed, waiting: summary.waiting, failed: summary.failed };
    state.lastError = "";
    return summary;
  } catch (error) {
    state.lastError = error.message;
    logger.error("Pesapal verification cycle failed", { trigger, error: error.message });
    return null;
  } finally {
    state.running = false;
  }
};

const startPesapalVerificationPoller = () => {
  state.enabled = Boolean(env.PESAPAL_VERIFICATION_POLLER_ENABLED);
  if (!state.enabled) {
    logger.info("Pesapal verification poller disabled", { envFlag: "PESAPAL_VERIFICATION_POLLER_ENABLED=false" });
    return;
  }
  if (timer) return;
  logger.info("Pesapal verification poller started", { intervalSeconds: state.intervalSeconds });
  timer = setInterval(() => void runVerificationCycle("interval"), state.intervalSeconds * 1000);
  setTimeout(() => void runVerificationCycle("startup"), 30 * 1000);
};

const stopPesapalVerificationPoller = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = {
  startPesapalVerificationPoller,
  stopPesapalVerificationPoller,
  runVerificationCycle,
  getPesapalVerificationPollerState: () => ({ ...state }),
  __testables: { decideVerification }
};
