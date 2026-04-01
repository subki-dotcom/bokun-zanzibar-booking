const express = require("express");
const validateRequest = require("../../../middleware/validateRequest");
const { authenticate } = require("../../../middleware/auth");
const dpoController = require("./dpo.controller");
const {
  createDpoSchema,
  paymentSuccessSchema,
  paymentCancelSchema
} = require("./dpo.validation");

const router = express.Router();

const optionalAuth = (req, res, next) => {
  if (!req.headers.authorization) {
    return next();
  }

  return authenticate(req, res, next);
};

router.post("/create", optionalAuth, validateRequest(createDpoSchema), dpoController.create);
router.get("/success", validateRequest(paymentSuccessSchema), dpoController.success);
router.get("/cancel", validateRequest(paymentCancelSchema), dpoController.cancel);

module.exports = router;
