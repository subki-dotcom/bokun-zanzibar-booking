const express = require("express");
const marketingController = require("../controllers/marketing.controller");
const validateRequest = require("../middleware/validateRequest");
const { captureLeadSchema } = require("../validators/marketing.validation");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");

const router = express.Router();

router.post("/leads", validateRequest(captureLeadSchema), marketingController.captureLead);
router.get("/recovery", authenticate, authorize("super_admin", "admin", "staff"), marketingController.listRecoveryLeads);

module.exports = router;
