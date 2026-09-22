const ProviderWebhookEvent = require("../../models/ProviderWebhookEvent");
const logger = require("../../config/logger");

const normalize = (value) => String(value || "").trim();
const eventKey = (provider, eventId) => `${normalize(provider).toLowerCase()}:${normalize(eventId)}`;

const claim = async ({ provider, eventId, eventType = "", leaseMs = 5 * 60 * 1000, EventModel = ProviderWebhookEvent }) => {
  const key = eventKey(provider, eventId);
  if (!normalize(provider) || !normalize(eventId)) throw new Error("Provider and eventId are required for webhook idempotency");
  const now = new Date();
  try {
    const created = await EventModel.create({ eventKey: key, provider, eventId, eventType, leaseExpiresAt: new Date(now.getTime() + leaseMs) });
    return { acquired: true, replay: false, event: created };
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  const existing = await EventModel.findOne({ eventKey: key });
  if (existing?.status === "failed" || (existing?.status === "processing" && existing.leaseExpiresAt && existing.leaseExpiresAt <= now)) {
    const reclaimed = await EventModel.findOneAndUpdate(
      { eventKey: key, status: existing.status, leaseExpiresAt: existing.leaseExpiresAt },
      { $set: { status: "processing", leaseExpiresAt: new Date(now.getTime() + leaseMs), lastErrorCode: "" }, $inc: { attempts: 1 } },
      { new: true }
    );
    if (reclaimed) return { acquired: true, replay: true, event: reclaimed };
  }
  logger.info("PAYMENT_WEBHOOK_REPLAY", { provider: normalize(provider), eventId: normalize(eventId), status: existing?.status || "processing" });
  return { acquired: false, replay: true, event: existing };
};

const complete = ({ event, EventModel = ProviderWebhookEvent }) => EventModel.updateOne(
  { _id: event._id, status: "processing" }, { $set: { status: "processed", processedAt: new Date(), leaseExpiresAt: null } }
);
const fail = ({ event, error, EventModel = ProviderWebhookEvent }) => EventModel.updateOne(
  { _id: event._id, status: "processing" }, { $set: { status: "failed", leaseExpiresAt: new Date(), lastErrorCode: String(error?.code || error?.name || "ERROR").slice(0, 100) } }
);

module.exports = { claim, complete, fail, eventKey };
