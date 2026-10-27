// Guest "My booking" (/api/my-booking). Booking data only with a session cookie for that same booking; anything
// else is a 404. Changes need the session's CSRF token, and every answer is no-store.
const express = require("express");
const controller = require("../controllers/myBooking.controller");
const validateRequest = require("../middleware/validateRequest");
const schemas = require("../validators/myBooking.validation");
const {
  myBookingLookupIpLimiter,
  myBookingLookupReferenceLimiter,
  myBookingSignInLimiter,
  myBookingCodeLimiter,
  myBookingInvoiceEmailLimiter,
  bookingRequestWriteLimiter
} = require("../middleware/rateLimiter");
const { noStore, loadSession, requireSession, requireSessionFor, requireSameOrigin, requireCsrf } = require("../middleware/myBookingSession");

const router = express.Router();
router.use(noStore, loadSession);

router.post("/lookup", requireSameOrigin, myBookingLookupIpLimiter, myBookingLookupReferenceLimiter, validateRequest(schemas.lookupSchema), controller.lookup);
router.post("/session", requireSameOrigin, myBookingSignInLimiter, validateRequest(schemas.openLinkSchema), controller.openLink);
router.post("/session/payment-key", requireSameOrigin, myBookingSignInLimiter, validateRequest(schemas.paymentKeySessionSchema), controller.openWithPaymentKey);
router.get("/session", controller.current);
router.post("/session/sign-out", requireSession, requireCsrf, controller.signOut);

const own = [requireSession, requireSessionFor("reference")];
router.get("/bookings/:reference", own, validateRequest(schemas.bookingSchema), controller.dashboard);
router.get("/bookings/:reference/invoice", own, controller.invoice);
router.post("/bookings/:reference/invoice/pdf-link", own, requireCsrf, controller.invoicePdfLink);
router.post("/bookings/:reference/invoice/email", own, requireCsrf, myBookingInvoiceEmailLimiter, controller.emailInvoice);
// The signed link from pdf-link (10 minutes), only with the session of that booking.
router.get("/documents/pdf", requireSession, controller.invoicePdf);
router.get("/bookings/:reference/ticket.pdf", own, controller.ticketPdf);
router.get("/bookings/:reference/ticket-qr.svg", own, controller.ticketQr);
router.get("/bookings/:reference/cancellation-estimate", own, controller.cancellationEstimate);
router.post("/bookings/:reference/requests", own, requireCsrf, bookingRequestWriteLimiter, validateRequest(schemas.submitRequestSchema), controller.submitRequest);
router.post("/bookings/:reference/contact/code", own, requireCsrf, myBookingCodeLimiter, controller.contactCode);
router.post("/bookings/:reference/contact/reveal", own, requireCsrf, myBookingCodeLimiter, validateRequest(schemas.revealContactSchema), controller.revealContact);

module.exports = router;
