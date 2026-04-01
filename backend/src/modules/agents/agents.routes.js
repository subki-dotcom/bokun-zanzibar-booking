const express = require("express");
const agentsController = require("./agents.controller");
const validateRequest = require("../../middleware/validateRequest");
const { createAgentSchema } = require("./agents.validation");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");

const router = express.Router();

router.post(
  "/",
  authenticate,
  authorize("super_admin", "admin"),
  validateRequest(createAgentSchema),
  agentsController.createAgent
);
router.get("/", authenticate, authorize("super_admin", "admin", "staff"), agentsController.listAgents);
router.get("/me/dashboard", authenticate, authorize("agent"), agentsController.myDashboard);
router.get("/me/statements/:month", authenticate, authorize("agent"), agentsController.myMonthlyStatement);

module.exports = router;