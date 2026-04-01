const express = require("express");
const commissionsController = require("./commissions.controller");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");

const router = express.Router();

router.get(
  "/summary",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  commissionsController.summary
);

module.exports = router;