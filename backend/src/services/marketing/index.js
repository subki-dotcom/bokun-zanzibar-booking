const MarketingLead = require("../../models/MarketingLead");

const cleanText = (value = "", maxLength = 300) => String(value || "").trim().slice(0, maxLength);

const captureLead = async (payload = {}) => {
  const email = cleanText(payload.email, 160).toLowerCase();
  const event = {
    stage: cleanText(payload.stage, 64) || "website_interest",
    occurredAt: new Date(),
    source: cleanText(payload.source, 80) || "website",
    context: payload.context && typeof payload.context === "object" ? payload.context : {}
  };
  const existing = await MarketingLead.findOne({ email });

  if (!existing) {
    const lead = await MarketingLead.create({
      email,
      firstName: cleanText(payload.firstName, 100),
      lastName: cleanText(payload.lastName, 100),
      phone: cleanText(payload.phone, 50),
      newsletterConsent: Boolean(payload.newsletterConsent),
      recoveryConsent: Boolean(payload.recoveryConsent),
      subscriptionStatus: payload.newsletterConsent ? "subscribed" : "unknown",
      lastSeenAt: event.occurredAt,
      journey: [event]
    });
    return lead.toObject();
  }

  if (payload.firstName) existing.firstName = cleanText(payload.firstName, 100);
  if (payload.lastName) existing.lastName = cleanText(payload.lastName, 100);
  if (payload.phone) existing.phone = cleanText(payload.phone, 50);
  if (payload.newsletterConsent) {
    existing.newsletterConsent = true;
    existing.subscriptionStatus = "subscribed";
  }
  if (payload.recoveryConsent) existing.recoveryConsent = true;
  existing.lastSeenAt = event.occurredAt;
  existing.journey = [...(existing.journey || []), event].slice(-30);
  await existing.save();
  return existing.toObject();
};

const listRecoveryLeads = async ({ limit = 100 } = {}) =>
  MarketingLead.find({ recoveryConsent: true, subscriptionStatus: { $ne: "unsubscribed" } })
    .sort({ lastSeenAt: -1 })
    .limit(Math.min(Math.max(Number(limit || 100), 1), 200))
    .lean();

module.exports = { captureLead, listRecoveryLeads };
