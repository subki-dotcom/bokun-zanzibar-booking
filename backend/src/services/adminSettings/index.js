// Admin "Settings": what the server is set up with (company details, email, security, Bókun, payments) and a test
// email. Values come from the environment (Render). Secrets are never returned, only whether they are set.
const { env } = require("../../config/env");
const emailService = require("../email");
const smtp = require("../email/smtp");
const paymentsService = require("../payments");
const AppError = require("../../utils/AppError");

const isSet = (value) => Boolean(String(value || "").trim());
// "info@zanzibartoursandsafaris.co.tz" stays readable; only the SMTP password is ever secret, and it is never sent.
const addressOf = (value = "") => (String(value).match(/<([^>]+)>/) || [null, value])[1].trim();

const getOverview = () => {
  const smtpReady = smtp.isSmtpConfigured();
  const resendReady = Boolean(env.EMAIL_ENABLED && isSet(env.RESEND_API_KEY) && isSet(env.EMAIL_FROM));
  let payments = null;
  try {
    payments = paymentsService.getPublicPaymentProviders();
  } catch {
    payments = null;
  }

  return {
    company: {
      brandName: env.BRAND_NAME || "",
      legalName: env.COMPANY_LEGAL_NAME || "",
      address: env.COMPANY_ADDRESS || "",
      taxId: env.COMPANY_TIN || "",
      licence: env.COMPANY_LICENCE || "",
      phone: env.SUPPORT_PHONE || "",
      email: env.EMAIL_REPLY_TO || "",
      website: env.PUBLIC_SITE_URL || ""
    },
    email: {
      provider: smtpReady ? "smtp" : resendReady ? "resend" : "none",
      ready: smtpReady || resendReady,
      smtpHost: smtpReady ? env.SMTP_HOST || "" : "",
      from: smtpReady ? addressOf(smtp.mailFrom()) : resendReady ? addressOf(env.EMAIL_FROM) : "",
      replyTo: env.EMAIL_REPLY_TO || "",
      contactInbox: env.CONTACT_TO_EMAIL || env.EMAIL_REPLY_TO || ""
    },
    security: {
      turnstile: isSet(env.TURNSTILE_SECRET_KEY)
    },
    bokun: {
      connected: isSet(env.BOKUN_ACCESS_KEY) && isSet(env.BOKUN_SECRET_KEY),
      bookingSync: Boolean(env.BOKUN_BOOKING_SYNC_ENABLED),
      confirmedImport: Boolean(env.BOKUN_CONFIRMED_BOOKING_IMPORT_ENABLED)
    },
    payments,
    system: {
      environment: env.NODE_ENV || "",
      where: "Render → backend service → Environment"
    }
  };
};

// Sends one test email to the signed-in admin, through the same path as guest emails (SMTP first, then Resend).
const sendTestEmail = async ({ to }) => {
  if (!to) throw new AppError("Your account has no email address.", 400, "SETTINGS_NO_EMAIL");
  if (!emailService.canSendEmail()) {
    throw new AppError("Email is not set up on the server (SMTP or Resend).", 503, "SETTINGS_EMAIL_NOT_CONFIGURED");
  }
  const brand = env.BRAND_NAME || "Admin";
  try {
    await emailService.deliverEmail({
      to,
      subject: `${brand}: test email`,
      html: `<p>This is a test email from the ${brand} admin Settings page.</p><p>If you can read this, guest emails (booking confirmations, My booking links, invoices) can be delivered.</p>`,
      text: `This is a test email from the ${brand} admin Settings page. If you can read this, guest emails can be delivered.`
    });
  } catch {
    throw new AppError("The email server refused the test email. Check the SMTP settings on Render.", 502, "SETTINGS_TEST_EMAIL_FAILED");
  }
  return { sentTo: to };
};

module.exports = { getOverview, sendTestEmail };
