const axios = require("axios");
const EmailDelivery = require("../../models/EmailDelivery");
const logger = require("../../config/logger");
const { env, isEmailConfigured } = require("../../config/env");
const smtp = require("./smtp");

const escapeHtml = (value = "") => String(value || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const formatMoney = (amount = 0, currency = "USD") => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount || 0));
  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
};

// Without a fresh sign-in link, emails point to the "Find your booking" form (never to booking data).
const bookingUrl = (booking = {}) => require("../myBooking/links").lookupUrl(booking.bookingReference || "");

const siteUrl = () => String(env.PUBLIC_SITE_URL || String(env.FRONTEND_URL || "").split(",")[0] || "").trim().replace(/\/+$/, "");

// The company line under every email: legal name, address and TIN (empty parts left out).
const legalLine = () =>
  [env.COMPANY_LEGAL_NAME || env.BRAND_NAME, env.COMPANY_ADDRESS, env.COMPANY_TIN ? `TIN ${env.COMPANY_TIN}` : "", env.COMPANY_LICENCE ? `Licence ${env.COMPANY_LICENCE}` : ""]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" &middot; ");

const buildEmailShell = ({ heading, body, ctaLabel = "View booking", ctaUrl = "" }) => `
  <div style="background:#f6f7f6;padding:32px 16px;font-family:Outfit,Arial,sans-serif;color:#14211f">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e3e7e5;border-radius:12px;padding:28px">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr>
        <td style="padding-right:10px"><img src="${escapeHtml(siteUrl())}/brand/icon-192.png" width="36" height="36" alt="" style="display:block;border-radius:9px"></td>
        <td style="color:#0e6b57;font-size:15px;font-weight:700">${escapeHtml(env.BRAND_NAME)}</td>
      </tr></table>
      <h1 style="margin:0 0 16px;font-size:24px;color:#14211f">${escapeHtml(heading)}</h1>
      <div style="color:#2a3836;font-size:15px;line-height:1.6">${body}</div>
      ${ctaUrl ? `<p style="margin:24px 0 0"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#0e6b57;color:#ffffff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:700">${escapeHtml(ctaLabel)}</a></p>` : ""}
      <p style="margin:26px 0 0;color:#55625f;font-size:13px">Need help? WhatsApp or call ${escapeHtml(env.SUPPORT_PHONE)} &middot; ${escapeHtml(env.EMAIL_REPLY_TO)}</p>
      <p style="margin:8px 0 0;color:#8a9592;font-size:12px">${legalLine()}</p>
    </div>
  </div>`;

const buildBookingEmail = (booking = {}, templateKey = "booking_confirmed", url = bookingUrl(booking)) => {
  const name = escapeHtml(`${booking.customer?.firstName || ""} ${booking.customer?.lastName || ""}`.trim() || "Traveler");
  const product = escapeHtml(booking.productTitle || "your Zanzibar experience");
  const option = escapeHtml(booking.optionTitle || "");
  const dateTime = [booking.travelDate, booking.startTime].filter(Boolean).map(escapeHtml).join(" at ");
  const reference = escapeHtml(booking.bookingReference || "");
  const amount = formatMoney(booking.amount || booking.pricingSnapshot?.finalPayable || 0, booking.currency || "USD");

  const base = `<p>Hello ${name},</p><p><strong>${product}</strong>${option ? ` &middot; ${option}` : ""}<br>${dateTime || "Travel details are being prepared."}<br>Booking reference: <strong>${reference}</strong></p>`;
  const templates = {
    payment_checkout: {
      subject: `Complete your payment for ${reference}`,
      heading: "Complete your secure payment",
      body: `${base}<p>Your total is <strong>${amount}</strong>. Your selected date and live price are reserved only while checkout remains active.</p>`,
      ctaLabel: "Complete payment"
    },
    payment_paid: {
      subject: `Payment received - ${reference}`,
      heading: "Payment received",
      body: `${base}<p>We received your payment of <strong>${amount}</strong>. We are confirming the activity with the supplier now.</p>`,
      ctaLabel: "Track booking"
    },
    supplier_confirmation_pending: {
      subject: `Payment received, supplier confirmation pending - ${reference}`,
      heading: "Payment received",
      body: `${base}<p>Your payment of <strong>${amount}</strong> is confirmed. Supplier confirmation is taking longer than usual; our team is monitoring it and no action is needed from you.</p>`,
      ctaLabel: "Track booking"
    },
    booking_confirmed: {
      subject: `Booking confirmed - ${reference}`,
      heading: "Your booking is confirmed",
      body: `${base}<p>Your payment is confirmed and the supplier has confirmed your booking. Keep this reference handy for pickup and support.</p>`,
      ctaLabel: "View booking"
    },
    payment_failed: {
      subject: `Payment update needed - ${reference}`,
      heading: "Your payment was not completed",
      body: `${base}<p>No payment was confirmed. You can safely return to your booking and choose an available payment method.</p>`,
      ctaLabel: "Try payment again"
    }
  };
  const template = templates[templateKey] || templates.booking_confirmed;
  return { subject: template.subject, html: buildEmailShell({ heading: template.heading, body: template.body, ctaLabel: template.ctaLabel, ctaUrl: url }) };
};

const buildBookingRequestEmail = (booking = {}, request = {}, templateKey = "request_received", url = bookingUrl(booking)) => {
  const name = escapeHtml(`${booking.customer?.firstName || ""} ${booking.customer?.lastName || ""}`.trim() || "Traveler");
  const bookingReference = escapeHtml(booking.bookingReference || "");
  const requestReference = escapeHtml(request.requestReference || "");
  const typeLabels = {
    reschedule: "travel date or time change",
    change_travelers: "traveler change",
    cancel_booking: "cancellation",
    combined_change: "booking change"
  };
  const type = escapeHtml(typeLabels[request.type] || "booking request");
  const reason = escapeHtml(request.adminDecision?.customerFacingReason || request.customerReason || "");
  const amount = formatMoney(
    request.refund?.estimatedAmount || Math.abs(Number(request.priceAdjustment?.difference || 0)),
    request.originalSnapshot?.currency || booking.currency || "USD"
  );
  const base = `<p>Hello ${name},</p><p>Booking: <strong>${bookingReference}</strong><br>Request: <strong>${requestReference}</strong><br>Type: ${type}</p>`;
  const templates = {
    request_received: { subject: `Request received - ${requestReference}`, heading: "Your request has been received", body: `${base}<p>Our team will review your request and update you by email.</p>` },
    request_under_review: { subject: `Request under review - ${requestReference}`, heading: "Your request is under review", body: `${base}<p>Our team is reviewing the details and supplier availability.</p>` },
    request_more_information: { subject: `More information needed - ${requestReference}`, heading: "We need more information", body: `${base}<p>${reason || "Please reply to this email with the requested details so we can continue."}</p>` },
    request_approved: { subject: `Request approved - ${requestReference}`, heading: "Your request was approved", body: `${base}<p>${reason || "We are completing the supplier update now."}</p>` },
    request_rejected: { subject: `Request update - ${requestReference}`, heading: "Your request could not be approved", body: `${base}<p>${reason || "Please contact our support team if you need help."}</p>` },
    additional_payment_required: { subject: `Additional payment required - ${requestReference}`, heading: "Additional payment is required", body: `${base}<p>The confirmed price difference is <strong>${amount}</strong>. We will send secure payment instructions before the booking change is finalized.</p>` },
    reschedule_completed: { subject: `Booking change completed - ${requestReference}`, heading: "Your booking change is complete", body: `${base}<p>Your updated travel details have been confirmed with the supplier.</p>` },
    traveler_change_completed: { subject: `Traveler change completed - ${requestReference}`, heading: "Your traveler change is complete", body: `${base}<p>Your updated traveler details have been confirmed with the supplier.</p>` },
    cancellation_confirmed: { subject: `Cancellation confirmed - ${requestReference}`, heading: "Your booking has been cancelled", body: `${base}<p>The supplier cancellation is confirmed. Any approved refund is tracked separately.</p>` },
    refund_processing: { subject: `Refund processing - ${requestReference}`, heading: "Your refund is processing", body: `${base}<p>Your approved refund of <strong>${amount}</strong> is being processed.</p>` },
    refund_completed: { subject: `Refund completed - ${requestReference}`, heading: "Your refund is complete", body: `${base}<p>Your refund of <strong>${amount}</strong> has been completed.</p>` },
    refund_failed: { subject: `Refund update needed - ${requestReference}`, heading: "Your refund needs attention", body: `${base}<p>We could not complete the refund automatically. Our support team will contact you shortly.</p>` }
  };
  const template = templates[templateKey] || templates.request_received;
  return {
    subject: template.subject,
    html: buildEmailShell({ heading: template.heading, body: template.body, ctaLabel: "View booking", ctaUrl: url })
  };
};

// "Zanzibar Tours & Safaris <bookings@…>": the address from EMAIL_FROM, always with this site's brand name.
const senderAddress = () => {
  const raw = String(env.EMAIL_FROM || "").trim();
  const address = (raw.match(/<([^>]+)>/) || [null, raw])[1].trim();
  return address ? `${env.BRAND_NAME.replace(/[<>"]/g, "")} <${address}>` : raw;
};

// attachments: [{ filename, content (Buffer) }]
const sendWithResend = async ({ to, subject, html, text = "", replyTo = "", attachments = [] }) => {
  const response = await axios.post(
    "https://api.resend.com/emails",
    {
      from: senderAddress(),
      to: [to],
      reply_to: replyTo || env.EMAIL_REPLY_TO || undefined,
      subject,
      html,
      text: text || undefined,
      attachments: attachments.length ? attachments.map((file) => ({ filename: file.filename, content: Buffer.from(file.content).toString("base64") })) : undefined
    },
    {
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "User-Agent": "zts-booking-backend/1.0"
      },
      timeout: 15000
    }
  );
  return response.data || {};
};

const toSafeEmailProviderError = (error = {}) => ({
  status: Number(error?.response?.status || 0) || null,
  code: String(error?.response?.data?.name || error?.code || "EMAIL_PROVIDER_REQUEST_FAILED"),
  message: String(error?.response?.data?.message || error?.message || "Email provider request failed").slice(0, 500)
});

// The confirmation and payment emails carry the invoice PDF (skipped quietly if it cannot be made).
const INVOICE_TEMPLATES = new Set(["booking_confirmed", "payment_paid", "supplier_confirmation_pending"]);
const invoiceAttachments = async (booking, templateKey, requestId = "") => {
  if (!INVOICE_TEMPLATES.has(templateKey)) return [];
  try {
    const documents = require("../invoiceDocuments");
    const views = await documents.getByBookingReference(booking.bookingReference);
    const { buffer, filename } = await documents.pdfFor(views.invoice);
    return [{ filename, content: buffer }];
  } catch (error) {
    logger.warn("Invoice PDF not attached", { bookingReference: booking.bookingReference, templateKey, requestId, code: error.code || "", error: error.message });
    return [];
  }
};

const sendEmailOnce = async ({ booking, templateKey, message, requestId = "" }) => {
  const recipient = String(booking?.customer?.email || "").trim().toLowerCase();
  if (!booking?.bookingReference || !recipient) return { status: "skipped", reason: "missing_recipient" };

  let delivery = await EmailDelivery.findOne({ bookingReference: booking.bookingReference, templateKey });
  if (delivery?.status === "sent") return { status: "sent", duplicate: true, delivery };
  if (delivery?.status === "processing") return { status: "processing", duplicate: true, delivery };

  if (!delivery) {
    try {
      delivery = await EmailDelivery.create({ bookingReference: booking.bookingReference, templateKey, recipient, status: "queued" });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      delivery = await EmailDelivery.findOne({ bookingReference: booking.bookingReference, templateKey });
      if (delivery?.status === "sent" || delivery?.status === "processing") return { status: delivery.status, duplicate: true, delivery };
    }
  }

  delivery.lastAttemptAt = new Date();

  if (!isEmailConfigured) {
    delivery.subject = message(bookingUrl(booking)).subject;
    delivery.status = "skipped";
    delivery.error = "Email delivery is not configured";
    await delivery.save();
    logger.info("Email delivery skipped: provider not configured", { bookingReference: booking.bookingReference, templateKey, requestId });
    return { status: "skipped", delivery };
  }

  delivery.status = "processing";
  delivery.error = "";
  await delivery.save();

  try {
    // Each email carries its own fresh sign-in link, so the guest lands signed in to this booking.
    const built = message(await require("../myBooking/links").emailAccessUrl(booking));
    delivery.subject = built.subject;
    const attachments = await invoiceAttachments(booking, templateKey, requestId);
    const providerResponse = await sendWithResend({ to: recipient, subject: built.subject, html: built.html, attachments });
    delivery.status = "sent";
    delivery.providerMessageId = String(providerResponse.id || "");
    delivery.sentAt = new Date();
    await delivery.save();
    return { status: "sent", delivery };
  } catch (error) {
    const providerError = toSafeEmailProviderError(error);
    delivery.status = "failed";
    delivery.error = providerError.message;
    await delivery.save();
    logger.error("Transactional email delivery failed", {
      providerError,
      bookingReference: booking.bookingReference,
      templateKey,
      requestId
    });
    return { status: "failed", delivery };
  }
};

const sendBookingEmailOnce = ({ booking, templateKey, requestId = "" }) =>
  sendEmailOnce({ booking, templateKey, message: (url) => buildBookingEmail(booking, templateKey, url), requestId });

const sendBookingRequestEmailOnce = ({ booking, request, templateKey, requestId = "" }) =>
  sendEmailOnce({
    booking,
    templateKey: `booking_request_${request?.requestReference || request?._id || "unknown"}_${templateKey}`,
    message: (url) => buildBookingRequestEmail(booking, request, templateKey, url),
    requestId
  });

// A message from the contact page, to the team's inbox (CONTACT_TO_EMAIL, else EMAIL_REPLY_TO). Every field is in
// the HTML and the plain-text body, escaped; Reply answers the visitor. Sent through SMTP when it is set up,
// otherwise through Resend. Returns { sent: true } or { sent: false, reason } (the reason is never shown to guests).
const contactRecipient = () => String(env.CONTACT_TO_EMAIL || env.EMAIL_REPLY_TO || "").trim();

// No line breaks in a header value (subject), whatever the visitor typed.
const oneLine = (value = "", max = 120) => String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);

const buildContactEmail = ({ name, email, phone = "", travelDate = "", message }) => {
  const fields = [
    ["Name", name],
    ["Email", email],
    ["Phone", phone || "—"],
    ["Travel date", travelDate || "—"]
  ];
  const html = `
  <div style="font-family:Arial,sans-serif;color:#14211f;max-width:640px">
    <h1 style="font-size:20px;margin:0 0 16px">New message from the contact page</h1>
    <table role="presentation" style="border-collapse:collapse;margin:0 0 16px;font-size:14px">${fields
      .map(([label, value]) => `<tr><td style="padding:6px 16px 6px 0;color:#55625f;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 0">${escapeHtml(value)}</td></tr>`)
      .join("")}</table>
    <p style="margin:0 0 6px;color:#55625f;font-size:14px">Message</p>
    <div style="white-space:pre-wrap;font-size:15px;line-height:1.55;padding:12px 14px;background:#f6f7f6;border-radius:8px">${escapeHtml(message)}</div>
    <p style="margin:16px 0 0;color:#8a9592;font-size:12px">Sent from the contact form on ${escapeHtml(env.BRAND_NAME)}. Press Reply to answer ${escapeHtml(name)}.</p>
  </div>`;
  const text = [
    "New message from the contact page",
    "",
    ...fields.map(([label, value]) => `${label}: ${value}`),
    "",
    "Message:",
    String(message || ""),
    "",
    `Press Reply to answer ${name}.`
  ].join("\n");
  return { subject: `New contact message from ${oneLine(name, 80)}`, html, text };
};

const sendContactMessage = async (
  { name, email, phone = "", travelDate = "", message },
  { smtpReady = smtp.isSmtpConfigured(), resendReady = isEmailConfigured } = {}
) => {
  const to = contactRecipient();
  if (!to) return { sent: false, reason: "no_recipient" };
  const { subject, html, text } = buildContactEmail({ name, email, phone, travelDate, message });
  try {
    if (smtpReady) {
      await smtp.sendSmtpMail({ to, replyTo: oneLine(email, 160), subject, html, text });
      return { sent: true, via: "smtp" };
    }
    if (resendReady) {
      await sendWithResend({ to, subject, html, text, replyTo: oneLine(email, 160) });
      return { sent: true, via: "resend" };
    }
    logger.error("Contact message not emailed: no SMTP or Resend settings");
    return { sent: false, reason: "email_not_configured" };
  } catch (error) {
    // Logged for the team; SMTP host, user and server replies never go back to the visitor.
    logger.error("Contact message email failed", {
      via: smtpReady ? "smtp" : "resend",
      code: String(error?.code || error?.response?.data?.name || ""),
      responseCode: Number(error?.responseCode || error?.response?.status || 0) || null,
      message: String(error?.message || "").slice(0, 300)
    });
    return { sent: false, reason: "provider_error" };
  }
};

// "My booking" emails that are sent every time they are asked for (no once-per-booking record). Without an email
// provider outside production the link is written to the server log so the flow can be tested locally.
const sendMyBookingEmail = async ({ to, subject, heading, body, ctaLabel = "", ctaUrl = "", devLog = "" }) => {
  if (!isEmailConfigured) {
    if (env.NODE_ENV !== "production" && devLog) logger.info(`[dev] My booking email not sent (no provider): ${devLog}`);
    return { sent: false, reason: "email_not_configured" };
  }
  try {
    await sendWithResend({ to, subject, html: buildEmailShell({ heading, body, ctaLabel, ctaUrl }) });
    return { sent: true };
  } catch (error) {
    logger.warn("My booking email failed", toSafeEmailProviderError(error));
    return { sent: false, reason: "provider_error" };
  }
};

const sendMyBookingLinkEmail = ({ booking, url, minutes }) =>
  sendMyBookingEmail({
    to: booking.customer.email,
    subject: `Your secure link to booking ${booking.bookingReference}`,
    heading: "Open your booking",
    body: `<p>Hello ${escapeHtml(booking.customer?.firstName || "Traveler")},</p><p>Use the button below to open booking <strong>${escapeHtml(booking.bookingReference)}</strong>. The link works once and expires in ${Number(minutes)} minutes.</p><p>If you did not ask for this link, you can ignore this email – nobody can open your booking without it.</p>`,
    ctaLabel: "Open my booking",
    ctaUrl: url,
    devLog: `${booking.bookingReference} → ${url}`
  });

const sendMyBookingCodeEmail = ({ booking, code, minutes }) =>
  sendMyBookingEmail({
    to: booking.customer.email,
    subject: `Your code: ${code}`,
    heading: "Your verification code",
    body: `<p>Enter this code to see the full traveler details of booking <strong>${escapeHtml(booking.bookingReference)}</strong>:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:12px 0">${escapeHtml(code)}</p><p>It expires in ${Number(minutes)} minutes. If you did not ask for it, you can ignore this email.</p>`,
    devLog: `${booking.bookingReference} code ${code}`
  });

// "Email me a copy" from the invoice page.
const sendInvoiceCopyEmail = async ({ booking, view, pdf, filename }) => {
  if (!isEmailConfigured) {
    if (env.NODE_ENV !== "production") logger.info(`[dev] Invoice email not sent (no provider): ${view.number} → ${booking.customer?.email}`);
    return { sent: false, reason: "email_not_configured" };
  }
  try {
    await sendWithResend({
      to: booking.customer.email,
      subject: `Invoice ${view.number} – ${booking.bookingReference}`,
      html: buildEmailShell({
        heading: `Your invoice ${escapeHtml(view.number)}`,
        body: `<p>Hello ${escapeHtml(booking.customer?.firstName || "Traveler")},</p><p>Your invoice for <strong>${escapeHtml(view.trip?.tour || booking.productTitle || "")}</strong> (booking ${escapeHtml(booking.bookingReference)}) is attached as a PDF.</p>`
      }),
      attachments: [{ filename, content: pdf }]
    });
    return { sent: true };
  } catch (error) {
    logger.warn("Invoice email failed", toSafeEmailProviderError(error));
    return { sent: false, reason: "provider_error" };
  }
};

module.exports = { buildContactEmail, sendInvoiceCopyEmail, sendBookingEmailOnce, sendBookingRequestEmailOnce, sendContactMessage, sendMyBookingLinkEmail, sendMyBookingCodeEmail };
