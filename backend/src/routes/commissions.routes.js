const express = require("express");
const commissionsController = require("../controllers/commissions.controller");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");

const router = express.Router();

router.get(
  "/summary",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  commissionsController.summary
);
router.get(
  "/agent-commissions",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  commissionsController.listAgentCommissions
);
router.post(
  "/agent-commissions/:id/mark-paid",
  authenticate,
  authorize("super_admin", "admin"),
  commissionsController.markPaid
);

module.exports = router;
