const express = require("express");
const validateRequest = require("../../middleware/validateRequest");
const { authenticate } = require("../../middleware/auth");
const paypalController = require("../../controllers/payments/paypal.controller");
const {
  createPaypalSchema,
  paymentSuccessSchema,
  paymentCancelSchema
} = require("../../validators/payments/paypal.validation");

const router = express.Router();

const optionalAuth = (req, res, next) => {
  if (!req.headers.authorization) {
    return next();
  }

  return authenticate(req, res, next);
};

router.post("/create", optionalAuth, validateRequest(createPaypalSchema), paypalController.create);
router.get("/success", validateRequest(paymentSuccessSchema), paypalController.success);
router.get("/cancel", validateRequest(paymentCancelSchema), paypalController.cancel);

module.exports = router;
