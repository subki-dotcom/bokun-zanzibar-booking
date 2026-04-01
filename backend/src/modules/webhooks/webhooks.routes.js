const express = require("express");
const webhooksController = require("./webhooks.controller");
const validateRequest = require("../../middleware/validateRequest");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");
const { pollBookingSyncSchema } = require("./webhooks.validation");

const router = express.Router();

router.post("/bokun", webhooksController.bokunWebhook);
router.post(
  "/bokun/poll",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  validateRequest(pollBookingSyncSchema),
  webhooksController.pollBookingSync
);

module.exports = router;
