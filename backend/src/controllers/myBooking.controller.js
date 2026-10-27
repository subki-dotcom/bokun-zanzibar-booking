const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { successResponse } = require("../utils/apiResponse");
const { resolveClientIp } = require("../middleware/rateLimiter");
const { setSessionCookie, clearSessionCookie } = require("../middleware/myBookingSession");
const service = require("../services/myBooking");
const { maskEmail } = require("../services/myBooking/core");

const context = (req) => ({ ip: resolveClientIp(req), userAgent: req.get("user-agent") || "", requestId: req.requestId || "" });

const lookup = asyncHandler(async (req, res) => {
  const { reference, email, captchaToken } = req.validated.body;
  const data = await service.requestLink({ reference, email, captchaToken, ...context(req) });
  return successResponse(res, { message: data.message, data: { sent: true } });
});

const openLink = asyncHandler(async (req, res) => {
  const { token, reference } = await service.verifyLink({ token: req.validated.body.token, ...context(req) });
  setSessionCookie(res, token);
  return successResponse(res, { message: "Signed in", data: { reference } });
});

const openWithPaymentKey = asyncHandler(async (req, res) => {
  const { reference, key } = req.validated.body;
  const result = await service.sessionFromPaymentKey({ reference, key, ...context(req) });
  setSessionCookie(res, result.token);
  return successResponse(res, { message: "Signed in", data: { reference: result.reference } });
});

// Who is signed in on this browser (never an error: signedIn false without a session).
const current = asyncHandler(async (req, res) => {
  const session = req.bookingSession;
  return successResponse(res, {
    message: "Session",
    data: session
      ? { signedIn: true, reference: session.bookingReference, email: maskEmail(session.email), csrfToken: service.csrfToken(session) }
      : { signedIn: false }
  });
});

const signOut = asyncHandler(async (req, res) => {
  await service.signOut({ session: req.bookingSession, ...context(req) });
  clearSessionCookie(res);
  return successResponse(res, { message: "Signed out", data: { signedIn: false } });
});

const dashboard = asyncHandler(async (req, res) =>
  successResponse(res, { message: "Booking", data: await service.getDashboard({ session: req.bookingSession }) })
);

const invoice = asyncHandler(async (req, res) =>
  successResponse(res, { message: "Invoice", data: await service.getInvoice({ session: req.bookingSession }) })
);

const invoicePdfLink = asyncHandler(async (req, res) =>
  successResponse(res, { message: "Download link", data: await service.invoicePdfLink({ session: req.bookingSession, number: String(req.body?.number || "") }) })
);

const invoicePdf = asyncHandler(async (req, res) => {
  const { buffer, filename } = await service.invoicePdf({ session: req.bookingSession, token: String(req.query?.token || "") });
  res.type("application/pdf");
  res.set("Content-Disposition", `${req.query?.inline === "1" ? "inline" : "attachment"}; filename="${filename}"`);
  return res.send(buffer);
});

const emailInvoice = asyncHandler(async (req, res) => {
  const data = await service.emailInvoiceCopy({ session: req.bookingSession, ...context(req) });
  return successResponse(res, { message: data.message, data: { sent: true } });
});

const ticketQr = asyncHandler(async (req, res) => {
  res.type("image/svg+xml");
  return res.send(await service.ticketQrSvg({ session: req.bookingSession }));
});

const ticketPdf = asyncHandler(async (req, res) => {
  const { filename, buffer } = await service.ticketPdf({ session: req.bookingSession });
  res.type("application/pdf");
  res.set("Content-Disposition", `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "")}"`);
  return res.send(buffer);
});

const cancellationEstimate = asyncHandler(async (req, res) =>
  successResponse(res, { message: "Cancellation estimate", data: await service.getCancellationEstimate({ session: req.bookingSession }) })
);

const submitRequest = asyncHandler(async (req, res) => {
  const idempotencyKey = String(req.get("idempotency-key") || "").trim();
  if (!/^[A-Za-z0-9-]{16,80}$/.test(idempotencyKey)) {
    throw new AppError("A request key is missing. Please reload the page and try again.", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }
  const data = await service.submitRequest({ session: req.bookingSession, payload: req.validated.body, idempotencyKey, ...context(req) });
  return successResponse(res, { message: "Your request has been received and is awaiting review.", data, statusCode: 201 });
});

const contactCode = asyncHandler(async (req, res) => {
  const data = await service.sendContactCode({ session: req.bookingSession, ...context(req) });
  return successResponse(res, { message: data.message, data: { sent: true } });
});

const revealContact = asyncHandler(async (req, res) =>
  successResponse(res, { message: "Traveler details", data: await service.revealContact({ session: req.bookingSession, code: req.validated.body.code, ...context(req) }) })
);

module.exports = { lookup, openLink, openWithPaymentKey, current, signOut, dashboard, invoice, invoicePdfLink, invoicePdf, emailInvoice, ticketQr, ticketPdf, cancellationEstimate, submitRequest, contactCode, revealContact };
