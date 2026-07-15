const axios = require("axios");
const EmailDelivery = require("../../models/EmailDelivery");
const logger = require("../../config/logger");
const { env, isEmailConfigured } = require("../../config/env");

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

const bookingUrl = (booking = {}) =>
  `${String(env.FRONTEND_URL || "").replace(/\/$/, "")}/my-booking/${encodeURIComponent(booking.bookingReference || "")}`;

const buildEmailShell = ({ heading, body, ctaLabel = "View booking", ctaUrl = "" }) => `
  <div style="background:#f5f7fa;padding:32px 16px;font-family:Arial,sans-serif;color:#0f172a">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #dde5ee;border-radius:12px;padding:28px">
      <p style="margin:0 0 8px;color:#079650;font-size:14px;font-weight:700">RISER TOURS &amp; SAFARIS</p>
      <h1 style="margin:0 0 16px;font-size:24px">${escapeHtml(heading)}</h1>
      <div style="color:#52617a;font-size:15px;line-height:1.6">${body}</div>
      ${ctaUrl ? `<p style="margin:24px 0 0"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#079650;color:#ffffff;padding:12px 18px;border-radius:7px;text-decoration:none;font-weight:700">${escapeHtml(ctaLabel)}</a></p>` : ""}
      <p style="margin:26px 0 0;color:#64748b;font-size:13px">Need help? +255 778 775 044 &middot; info@risertoursandsafaris.co.tz</p>
    </div>
  </div>`;

const buildBookingEmail = (booking = {}, templateKey = "booking_confirmed") => {
  const name = escapeHtml(`${booking.customer?.firstName || ""} ${booking.customer?.lastName || ""}`.trim() || "Traveler");
  const product = escapeHtml(booking.productTitle || "your Zanzibar experience");
  const option = escapeHtml(booking.optionTitle || "");
  const dateTime = [booking.travelDate, booking.startTime].filter(Boolean).map(escapeHtml).join(" at ");
  const reference = escapeHtml(booking.bookingReference || "");
  const amount = formatMoney(booking.amount || booking.pricingSnapshot?.finalPayable || 0, booking.currency || "USD");
  const url = bookingUrl(booking);

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

const buildBookingRequestEmail = (booking = {}, request = {}, templateKey = "request_received") => {
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
    html: buildEmailShell({ heading: template.heading, body: template.body, ctaLabel: "View booking", ctaUrl: bookingUrl(booking) })
  };
};

const sendWithResend = async ({ to, subject, html }) => {
  const response = await axios.post(
    "https://api.resend.com/emails",
    {
      from: env.EMAIL_FROM,
      to: [to],
      reply_to: env.EMAIL_REPLY_TO || undefined,
      subject,
      html
    },
    {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
      timeout: 15000
    }
  );
  return response.data || {};
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

  delivery.subject = message.subject;
  delivery.lastAttemptAt = new Date();

  if (!isEmailConfigured) {
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
    const providerResponse = await sendWithResend({ to: recipient, subject: message.subject, html: message.html });
    delivery.status = "sent";
    delivery.providerMessageId = String(providerResponse.id || "");
    delivery.sentAt = new Date();
    await delivery.save();
    return { status: "sent", delivery };
  } catch (error) {
    delivery.status = "failed";
    delivery.error = String(error.response?.data?.message || error.message || "Email provider request failed").slice(0, 500);
    await delivery.save();
    logger.error("Transactional email delivery failed", { err: error, bookingReference: booking.bookingReference, templateKey, requestId });
    return { status: "failed", delivery };
  }
};

const sendBookingEmailOnce = ({ booking, templateKey, requestId = "" }) =>
  sendEmailOnce({ booking, templateKey, message: buildBookingEmail(booking, templateKey), requestId });

const sendBookingRequestEmailOnce = ({ booking, request, templateKey, requestId = "" }) =>
  sendEmailOnce({
    booking,
    templateKey: `booking_request_${request?.requestReference || request?._id || "unknown"}_${templateKey}`,
    message: buildBookingRequestEmail(booking, request, templateKey),
    requestId
  });

module.exports = { sendBookingEmailOnce, sendBookingRequestEmailOnce };
