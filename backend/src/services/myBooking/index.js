// Guest "My booking": sign-in by one-time email link, a 30-day session bound to one booking, and everything the
// signed-in guest may see or ask for. Every function that returns booking data takes the session, never a reference.
const axios = require("axios");
const QRCode = require("qrcode");
const Booking = require("../../models/Booking");
const BookingAccessLink = require("../../models/BookingAccessLink");
const BookingSession = require("../../models/BookingSession");
const BookingRequest = require("../../models/BookingRequest");
const MyBookingActionKey = require("../../models/MyBookingActionKey");
const Payment = require("../../models/Payment");
const ProductSnapshot = require("../../models/ProductSnapshot");
const AuditLog = require("../../models/AuditLog");
const logger = require("../../config/logger");
const { env } = require("../../config/env");
const AppError = require("../../utils/AppError");
const emailService = require("../email");
const invoicesService = require("../invoices");
const invoiceDocuments = require("../invoiceDocuments");
const bookingRequestsService = require("../bookingRequests");
const { calculateCancellationPolicy } = require("../cancellations/policy");
const { hasPaymentAccess, paymentAccessKey } = require("../payments/paymentRecoveryCore");
const { issueAccessLink, publicSiteUrl } = require("./links");
const { buildDashboard } = require("./view");
const { buildTicketPdf } = require("./ticketPdf");
const core = require("./core");

const LOOKUP_MESSAGE = "If the details match, we've sent a link to your email.";
// At most this many links per booking in 15 minutes, whatever the address asking.
const LINKS_PER_BOOKING_WINDOW = 3;

// One answer for every booking a session may not open: never says whether it exists.
const notFound = () => new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
const linkInvalid = () => new AppError("This link has expired or was already used. Ask for a new one.", 410, "MY_BOOKING_LINK_INVALID");

const audit = (action, { booking = null, reference = "", ip = "", userAgent = "", requestId = "", metadata = {} } = {}) =>
  AuditLog.create({
    actorRole: "customer",
    action,
    entityType: "booking",
    entityId: String(booking?._id || reference || "unknown"),
    reference: booking?.bookingReference || reference || "",
    requestId,
    ipAddress: ip,
    userAgent: String(userAgent || "").slice(0, 300),
    metadata
  }).catch((error) => logger.warn("My booking audit write failed", { action, error: error.message }));

// Cloudflare Turnstile. Without a secret (local development) the check is skipped; production logs it as missing.
const verifyTurnstile = async ({ token = "", ip = "" }) => {
  if (!env.TURNSTILE_SECRET_KEY) {
    if (env.NODE_ENV === "production") logger.warn("TURNSTILE_SECRET_KEY is not set: the booking lookup has no bot check");
    return true;
  }
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: String(token), remoteip: ip });
    const { data } = await axios.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", body, { timeout: 8000 });
    return Boolean(data?.success);
  } catch (error) {
    logger.warn("Turnstile verification failed", { error: error.message });
    return false;
  }
};

// "Find your booking": always the same answer. A link is emailed only when the reference and email match.
const requestLink = async ({ reference = "", email = "", captchaToken = "", ip = "", userAgent = "", requestId = "" }) => {
  if (!(await verifyTurnstile({ token: captchaToken, ip }))) {
    throw new AppError("Please complete the security check and try again.", 400, "MY_BOOKING_CAPTCHA_FAILED");
  }
  const ref = core.normalizeReference(reference);
  const wanted = core.normalizeEmail(email);
  const booking = core.isPlausibleReference(ref) ? await Booking.findOne({ bookingReference: ref }, { bookingReference: 1, customer: 1 }).lean() : null;
  const matches = Boolean(booking && wanted && core.safeEqual(core.normalizeEmail(booking.customer?.email), wanted));

  if (!matches) {
    logger.warn("My booking lookup did not match", { reference: ref.slice(0, 40), ip, requestId, bookingExists: Boolean(booking) });
    audit("my_booking_lookup_failed", { reference: ref.slice(0, 40), ip, userAgent, requestId, metadata: { bookingExists: Boolean(booking) } });
    return { message: LOOKUP_MESSAGE };
  }

  const recent = await BookingAccessLink.countDocuments({ booking: booking._id, purpose: "lookup", createdAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) } });
  if (recent >= LINKS_PER_BOOKING_WINDOW) {
    logger.warn("My booking link throttled for booking", { reference: ref, ip, requestId });
    audit("my_booking_link_throttled", { booking, ip, userAgent, requestId });
    return { message: LOOKUP_MESSAGE };
  }

  const { url } = await issueAccessLink({ booking, purpose: "lookup", requestIp: ip });
  audit("my_booking_link_sent", { booking, ip, userAgent, requestId });
  // Not awaited: a matching lookup must not take visibly longer than a wrong one.
  emailService.sendMyBookingLinkEmail({ booking, url, minutes: core.LINK_TTL_MINUTES }).catch(() => {});
  return { message: LOOKUP_MESSAGE };
};

const createSession = async ({ booking, source, ip = "", userAgent = "" }) => {
  const token = core.randomSecret(32);
  const session = await BookingSession.create({
    sessionHash: core.hashSecret(token),
    booking: booking._id,
    bookingReference: booking.bookingReference,
    email: core.normalizeEmail(booking.customer?.email),
    source,
    expiresAt: new Date(Date.now() + core.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000),
    lastSeenAt: new Date(),
    createdIp: ip,
    userAgent: String(userAgent || "").slice(0, 300)
  });
  return { token, session };
};

// Opening an emailed link: used up atomically (works once), within 30 minutes, for its own booking only.
const verifyLink = async ({ token = "", ip = "", userAgent = "", requestId = "" }) => {
  const value = String(token || "").trim();
  if (value.length < 20 || value.length > 200) throw linkInvalid();
  const link = await BookingAccessLink.findOneAndUpdate(
    { tokenHash: core.hashSecret(value), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true }
  );
  if (!link) {
    logger.warn("My booking link rejected", { ip, requestId });
    audit("my_booking_link_rejected", { ip, userAgent, requestId });
    throw linkInvalid();
  }
  const booking = await Booking.findById(link.booking, { bookingReference: 1, customer: 1 }).lean();
  // The booking email changed since the link was sent: the link no longer opens it.
  if (!booking || core.normalizeEmail(booking.customer?.email) !== link.email) throw linkInvalid();
  const created = await createSession({ booking, source: "magic_link", ip, userAgent });
  audit("my_booking_signed_in", { booking, ip, userAgent, requestId, metadata: { source: link.purpose } });
  return { ...created, reference: booking.bookingReference };
};

// The confirmation page after paying holds the payment link's key; it may sign in for the first days only.
const sessionFromPaymentKey = async ({ reference = "", key = "", ip = "", userAgent = "", requestId = "" }) => {
  const booking = await Booking.findOne({ bookingReference: core.normalizeReference(reference) }).lean();
  const fresh = booking && Date.now() - new Date(booking.createdAt || 0).getTime() <= core.PAYMENT_KEY_SESSION_DAYS * 24 * 60 * 60 * 1000;
  if (!booking || !fresh || !booking.customer?.email || !hasPaymentAccess(booking, key, env.JWT_SECRET)) {
    audit("my_booking_payment_key_rejected", { reference: String(reference).slice(0, 40), ip, userAgent, requestId });
    throw notFound();
  }
  const created = await createSession({ booking, source: "payment_key", ip, userAgent });
  audit("my_booking_signed_in", { booking, ip, userAgent, requestId, metadata: { source: "payment_key" } });
  return { ...created, reference: booking.bookingReference };
};

const resolveSession = async (token = "") => {
  const value = String(token || "").trim();
  if (value.length < 20 || value.length > 200) return null;
  const session = await BookingSession.findOne({ sessionHash: core.hashSecret(value), revokedAt: null, expiresAt: { $gt: new Date() } });
  if (!session) return null;
  // At most one write an hour for "last seen".
  if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > 60 * 60 * 1000) {
    BookingSession.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return session;
};

const signOut = async ({ session, ip = "", userAgent = "", requestId = "" }) => {
  if (!session) return;
  await BookingSession.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } });
  audit("my_booking_signed_out", { reference: session.bookingReference, ip, userAgent, requestId });
};

// The session's booking. A booking whose email changed after sign-in is no longer open to that session.
const sessionBooking = async (session, { lean = true } = {}) => {
  const query = Booking.findById(session.booking);
  const booking = lean ? await query.lean() : await query;
  if (!booking || core.normalizeEmail(booking.customer?.email) !== session.email) throw notFound();
  return booking;
};

const csrfToken = (session) => core.csrfTokenFor(String(session._id), env.JWT_SECRET);

const getDashboard = async ({ session }) => {
  const booking = await sessionBooking(session);
  const [product, requests, payment, invoice] = await Promise.all([
    ProductSnapshot.findOne(
      { bokunProductId: String(booking.bokunProductId || "") },
      { title: 1, slug: 1, images: 1, duration: 1, options: 1, meetingInfo: 1, pickupPlaces: 1, cancellationPolicy: 1 }
    ).lean(),
    BookingRequest.find({ booking: booking._id }).sort({ createdAt: -1 }).populate("refund.refundId").lean(),
    Payment.findOne({ bookingReference: booking.bookingReference, paidAt: { $ne: null } }, { provider: 1, paidAt: 1 }).sort({ paidAt: -1 }).lean(),
    invoicesService.getInvoiceByBookingReference(booking.bookingReference)
  ]);
  const policy = calculateCancellationPolicy({ booking, productSnapshot: product, amountPaid: booking.invoiceSnapshot?.amountPaid ?? 0 });
  const key = paymentAccessKey(booking, env.JWT_SECRET);
  const payHref = `/payment-processing?checkoutKey=${encodeURIComponent(key)}&bookingReference=${encodeURIComponent(booking.bookingReference)}`;
  return buildDashboard({
    booking,
    product,
    requests,
    policy,
    payment,
    invoiceAvailable: Boolean(invoice),
    payHref,
    csrfToken: csrfToken(session),
    sessionEmail: session.email
  });
};

// The invoice (and any credit notes) of the session's booking, as customer documents.
const getInvoice = async ({ session }) => {
  const booking = await sessionBooking(session);
  return invoiceDocuments.withQrCodes(await invoiceDocuments.getByBookingReference(booking.bookingReference));
};

// A 10-minute download link for the invoice or one of its credit notes.
const invoicePdfLink = async ({ session, number = "" }) => {
  const booking = await sessionBooking(session);
  const document = invoiceDocuments.pickDocument(await invoiceDocuments.getByBookingReference(booking.bookingReference), number);
  const { token, expiresAt } = invoiceDocuments.signDownloadLink({ bookingReference: booking.bookingReference, number: document.number });
  return { url: `/api/my-booking/documents/pdf?token=${encodeURIComponent(token)}`, expiresAt, filename: require("../invoiceDocuments/pdf").pdfFileName(document) };
};

// The PDF behind a signed link: the link must be valid and for the session's own booking.
const invoicePdf = async ({ session, token = "" }) => {
  const booking = await sessionBooking(session);
  const link = invoiceDocuments.readDownloadLink(token);
  if (!link) throw new AppError("This download link has expired. Please download the invoice again.", 410, "INVOICE_LINK_EXPIRED");
  if (link.bookingReference !== booking.bookingReference) throw notFound();
  return invoiceDocuments.pdfFor(invoiceDocuments.pickDocument(await invoiceDocuments.getByBookingReference(link.bookingReference), link.number));
};

// "Email me a copy": the PDF to the booking email (never another address).
const emailInvoiceCopy = async ({ session, ip = "", userAgent = "", requestId = "" }) => {
  const booking = await sessionBooking(session);
  const views = await invoiceDocuments.getByBookingReference(booking.bookingReference);
  const { buffer, filename } = await invoiceDocuments.pdfFor(views.invoice);
  const result = await emailService.sendInvoiceCopyEmail({ booking, view: views.invoice, pdf: buffer, filename });
  audit("my_booking_invoice_emailed", { booking, ip, userAgent, requestId, metadata: { invoiceNumber: views.invoice.number, sent: result.sent } });
  if (!result.sent) throw new AppError("We couldn't send the email right now. Please download the PDF instead.", 503, "INVOICE_EMAIL_FAILED");
  return { message: `We've emailed invoice ${views.invoice.number} to ${core.maskEmail(booking.customer.email)}.` };
};

const ticketQrSvg = async ({ session }) => {
  const booking = await sessionBooking(session);
  return QRCode.toString(core.ticketCode(booking.bookingReference, env.JWT_SECRET), { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#14211F", light: "#FFFFFF" } });
};

const ticketPdf = async ({ session }) => {
  const data = await getDashboard({ session });
  const booking = await sessionBooking(session);
  const qr = QRCode.create(core.ticketCode(booking.bookingReference, env.JWT_SECRET), { errorCorrectionLevel: "M" });
  return { filename: `${data.reference}-e-ticket.pdf`, buffer: await buildTicketPdf({ data, qr, brand: env.BRAND_NAME, phone: env.SUPPORT_PHONE, email: env.EMAIL_REPLY_TO, site: publicSiteUrl() }) };
};

const getCancellationEstimate = async ({ session }) => {
  const booking = await sessionBooking(session);
  const estimate = await bookingRequestsService.getCancellationEstimate({ bookingId: booking._id, customerEmail: booking.customer.email });
  return {
    currency: estimate.currency || booking.currency || "USD",
    amountPaid: Number(estimate.amountPaid || 0),
    cancellationFee: estimate.estimatedCancellationFee ?? null,
    refund: estimate.estimatedRefundAmount ?? null,
    freeCancellation: Boolean(estimate.isFreeCancellationAvailable),
    deadline: estimate.deadline || "",
    requiresManualReview: Boolean(estimate.requiresManualReview),
    reviewReason: estimate.reviewReason || "",
    summary: estimate.policySummary || ""
  };
};

// A change or cancel request, once per idempotency key (a double click or a retried request makes one request).
const submitRequest = async ({ session, payload, idempotencyKey, ip = "", userAgent = "", requestId = "" }) => {
  const booking = await sessionBooking(session);
  const key = `${booking._id}:${String(idempotencyKey)}`;
  // Atomic claim of the key (the unique index also guards two requests at the same instant).
  let previous = null;
  try {
    previous = await MyBookingActionKey.findOneAndUpdate(
      { key },
      { $setOnInsert: { key, booking: booking._id, action: payload.type, status: "processing" } },
      { upsert: true, new: false }
    ).lean();
  } catch (error) {
    if (error?.code !== 11000) throw error;
    previous = await MyBookingActionKey.findOne({ key }).lean();
  }
  if (previous) {
    if (previous.status === "done") return previous.response;
    throw new AppError("This request is already being sent.", 409, "MY_BOOKING_REQUEST_IN_PROGRESS");
  }
  try {
    const request = await bookingRequestsService.submitRequest({
      bookingId: booking._id,
      customerEmail: booking.customer.email,
      payload,
      requestId
    });
    const response = { reference: request.requestReference, type: request.type, status: request.status };
    await MyBookingActionKey.updateOne({ key }, { $set: { status: "done", response } });
    audit(payload.type === "cancel_booking" ? "my_booking_cancel_requested" : "my_booking_change_requested", {
      booking,
      ip,
      userAgent,
      requestId,
      metadata: { requestReference: request.requestReference, type: payload.type }
    });
    return response;
  } catch (error) {
    // A failed attempt may be retried with the same key.
    await MyBookingActionKey.deleteOne({ key }).catch(() => {});
    throw error;
  }
};

// Full traveler details: first a code to the booking email, then the details for 15 minutes.
const sendContactCode = async ({ session, ip = "", userAgent = "", requestId = "" }) => {
  const booking = await sessionBooking(session);
  const code = core.sixDigitCode();
  await BookingSession.updateOne(
    { _id: session._id },
    { $set: { contactCode: { hash: core.hashSecret(`${session._id}:${code}`), expiresAt: new Date(Date.now() + core.CONTACT_CODE_TTL_MINUTES * 60 * 1000), attempts: 0 } } }
  );
  await emailService.sendMyBookingCodeEmail({ booking, code, minutes: core.CONTACT_CODE_TTL_MINUTES });
  audit("my_booking_contact_code_sent", { booking, ip, userAgent, requestId });
  return { message: "We've emailed you a 6-digit code." };
};

const revealContact = async ({ session, code = "", ip = "", userAgent = "", requestId = "" }) => {
  const fresh = await BookingSession.findById(session._id);
  const stored = fresh?.contactCode || {};
  const usable = stored.hash && stored.expiresAt && stored.expiresAt.getTime() > Date.now() && Number(stored.attempts || 0) < core.CONTACT_CODE_MAX_ATTEMPTS;
  if (!usable) throw new AppError("This code has expired. Ask for a new one.", 400, "MY_BOOKING_CODE_EXPIRED");
  if (!core.safeEqual(core.hashSecret(`${session._id}:${String(code).trim()}`), stored.hash)) {
    await BookingSession.updateOne({ _id: session._id }, { $inc: { "contactCode.attempts": 1 } });
    audit("my_booking_contact_code_failed", { reference: session.bookingReference, ip, userAgent, requestId });
    throw new AppError("That code is not right. Please check the email and try again.", 400, "MY_BOOKING_CODE_INVALID");
  }
  await BookingSession.updateOne({ _id: session._id }, { $set: { "contactCode.hash": "", contactVerifiedUntil: new Date(Date.now() + 15 * 60 * 1000) } });
  const booking = await sessionBooking(session);
  audit("my_booking_contact_revealed", { booking, ip, userAgent, requestId });
  return {
    firstName: booking.customer?.firstName || "",
    lastName: booking.customer?.lastName || "",
    email: booking.customer?.email || "",
    phone: booking.customer?.phone || "",
    country: booking.customer?.country || "",
    hotelName: booking.customer?.hotelName || ""
  };
};

module.exports = {
  LOOKUP_MESSAGE,
  requestLink,
  verifyLink,
  sessionFromPaymentKey,
  resolveSession,
  signOut,
  csrfToken,
  getDashboard,
  getInvoice,
  invoicePdfLink,
  invoicePdf,
  emailInvoiceCopy,
  ticketQrSvg,
  ticketPdf,
  getCancellationEstimate,
  submitRequest,
  sendContactCode,
  revealContact,
  __testables: { verifyTurnstile }
};
