const MarketingLead = require("../../models/MarketingLead");
const emailService = require("../email");
const AppError = require("../../utils/AppError");
const logger = require("../../config/logger");

const cleanText = (value = "", maxLength = 300) => String(value || "").trim().slice(0, maxLength);

// A message from the contact page: kept with the guest's lead, then emailed to the team's inbox. If the email cannot
// be sent the message stays saved, the failure is logged, and the visitor is told to use WhatsApp or email instead.
const sendContactMessage = async ({ name, email, phone = "", travelDate = "", message, website = "" }) => {
  // Robots fill in the hidden "website" field; they get the same answer and nothing is kept.
  if (website) return { received: true };
  const [firstName, ...rest] = String(name).trim().split(/\s+/);
  await captureLead({
    email,
    firstName,
    lastName: rest.join(" "),
    phone,
    stage: "contact_message",
    source: "contact_page",
    context: { message: String(message).slice(0, 2000), travelDate }
  });
  const delivery = await emailService.sendContactMessage({ name, email, phone, travelDate, message });
  if (!delivery.sent) {
    logger.error("Contact message saved but not emailed", { reason: delivery.reason, email: String(email).replace(/^(.).*(@.*)$/, "$1***$2") });
    throw new AppError("We could not send your message. Please try again, or contact us on WhatsApp.", 502, "CONTACT_EMAIL_FAILED");
  }
  return { received: true, emailed: true };
};

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

module.exports = { captureLead, listRecoveryLeads, sendContactMessage };
