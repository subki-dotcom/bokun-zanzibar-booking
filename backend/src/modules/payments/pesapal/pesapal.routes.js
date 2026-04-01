const express = require("express");
const validateRequest = require("../../../middleware/validateRequest");
const { authenticate } = require("../../../middleware/auth");
const pesapalController = require("./pesapal.controller");
const {
  createPesapalSchema,
  paymentSuccessSchema,
  paymentCancelSchema
} = require("./pesapal.validation");

const router = express.Router();

const optionalAuth = (req, res, next) => {
  if (!req.headers.authorization) {
    return next();
  }

  return authenticate(req, res, next);
};

router.post("/create", optionalAuth, validateRequest(createPesapalSchema), pesapalController.create);
router.get("/success", validateRequest(paymentSuccessSchema), pesapalController.success);
router.get("/cancel", validateRequest(paymentCancelSchema), pesapalController.cancel);

module.exports = router;
