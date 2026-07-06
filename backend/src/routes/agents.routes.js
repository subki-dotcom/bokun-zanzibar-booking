const express = require("express");
const agentsController = require("../controllers/agents.controller");
const validateRequest = require("../middleware/validateRequest");
const {
  createAgentSchema,
  updateAgentProfileSchema,
  updatePayoutMethodSchema,
  updateAgentSettingsSchema,
  updateAgentStatusSchema,
  updateAgentCommissionSchema
} = require("../validators/agents.validation");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");

const router = express.Router();

router.post(
  "/",
  authenticate,
  authorize("super_admin", "admin"),
  validateRequest(createAgentSchema),
  agentsController.createAgent
);
router.get("/", authenticate, authorize("super_admin", "admin", "staff"), agentsController.listAgents);
router.post(
  "/:id/update-status",
  authenticate,
  authorize("super_admin", "admin"),
  validateRequest(updateAgentStatusSchema),
  agentsController.updateStatus
);
router.post(
  "/:id/update-commission",
  authenticate,
  authorize("super_admin", "admin"),
  validateRequest(updateAgentCommissionSchema),
  agentsController.updateCommission
);

router.get("/dashboard", authenticate, authorize("agent"), agentsController.myDashboard);
router.get("/products", authenticate, authorize("agent"), agentsController.products);
router.get("/products/:id/options", authenticate, authorize("agent"), agentsController.productOptions);
router.post("/bookings/validate", authenticate, authorize("agent"), agentsController.validateBooking);
router.get("/bookings", authenticate, authorize("agent"), agentsController.myBookings);
router.get("/bookings/:id", authenticate, authorize("agent"), agentsController.myBookingDetails);
router.get("/bookings/:id/voucher", authenticate, authorize("agent"), agentsController.myBookingVoucher);
router.post("/bookings/:id/resend-confirmation", authenticate, authorize("agent"), agentsController.resendVoucher);
router.get("/commissions", authenticate, authorize("agent"), agentsController.myCommissions);
router.get("/payout-requests", authenticate, authorize("agent"), agentsController.myPayoutRequests);
router.post("/payout-requests", authenticate, authorize("agent"), agentsController.requestPayout);
router.get("/notifications", authenticate, authorize("agent"), agentsController.myNotifications);
router.get("/activity", authenticate, authorize("agent"), agentsController.myActivity);
router.get("/reports", authenticate, authorize("agent"), agentsController.myReports);
router.post("/terms/accept", authenticate, authorize("agent"), agentsController.acceptTerms);
router.get("/profile", authenticate, authorize("agent"), agentsController.myProfile);
router.post(
  "/profile/update",
  authenticate,
  authorize("agent"),
  validateRequest(updateAgentProfileSchema),
  agentsController.updateMyProfile
);
router.get("/payout-method", authenticate, authorize("agent"), agentsController.myPayoutMethod);
router.post(
  "/payout-method/update",
  authenticate,
  authorize("agent"),
  validateRequest(updatePayoutMethodSchema),
  agentsController.updateMyPayoutMethod
);
router.get("/settings", authenticate, authorize("agent"), agentsController.mySettings);
router.post(
  "/settings/update",
  authenticate,
  authorize("agent"),
  validateRequest(updateAgentSettingsSchema),
  agentsController.updateMySettings
);

router.get("/me/dashboard", authenticate, authorize("agent"), agentsController.myDashboard);
router.get("/me/statements/:month", authenticate, authorize("agent"), agentsController.myMonthlyStatement);

module.exports = router;
