const express = require("express");
const controller = require("../controllers/adminBookingRequests.controller");
const validateRequest = require("../middleware/validateRequest");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");
const schemas = require("../validators/bookingRequests.validation");

const router = express.Router();
router.use(authenticate, authorize("super_admin", "admin", "staff"));
router.get("/booking-requests", validateRequest(schemas.adminRequestListSchema), controller.list);
router.get("/booking-requests/:id", validateRequest(schemas.adminRequestIdSchema), controller.get);
router.post("/booking-requests/:id/approve", validateRequest(schemas.adminApproveSchema), controller.approve);
router.post("/booking-requests/:id/reject", validateRequest(schemas.adminDecisionSchema), controller.reject);
router.post("/booking-requests/:id/request-information", validateRequest(schemas.adminDecisionSchema), controller.requestInformation);
router.post("/booking-requests/:id/recalculate-price", validateRequest(schemas.adminRequestIdSchema), controller.recalculate);
router.post("/booking-requests/:id/retry-bokun-sync", validateRequest(schemas.adminRequestIdSchema), controller.retryBokun);
router.post("/booking-requests/:id/send-email", validateRequest(schemas.adminRequestIdSchema), controller.retryEmail);
router.post("/payment-adjustments/:id/mark-paid", validateRequest(schemas.adjustmentPaidSchema), controller.markAdjustmentPaid);
router.post("/refunds/:id/status", authorize("super_admin", "admin"), validateRequest(schemas.refundStatusSchema), controller.updateRefund);

module.exports = router;
