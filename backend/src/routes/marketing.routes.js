const express = require("express");
const marketingController = require("../controllers/marketing.controller");
const validateRequest = require("../middleware/validateRequest");
const { captureLeadSchema, contactMessageSchema } = require("../validators/marketing.validation");
const { contactMessageLimiter } = require("../middleware/rateLimiter");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");

const router = express.Router();

router.post("/leads", validateRequest(captureLeadSchema), marketingController.captureLead);
router.post("/contact", contactMessageLimiter, validateRequest(contactMessageSchema), marketingController.sendContactMessage);
router.get("/recovery", authenticate, authorize("super_admin", "admin", "staff"), marketingController.listRecoveryLeads);

module.exports = router;
