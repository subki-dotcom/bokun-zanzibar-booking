const express = require("express");
const validateRequest = require("../../middleware/validateRequest");
const { authenticate } = require("../../middleware/auth");
const dpoController = require("../../controllers/payments/dpo.controller");
const {
  createDpoSchema,
  paymentSuccessSchema,
  paymentCancelSchema,
  dpoCallbackSchema
} = require("../../validators/payments/dpo.validation");

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
router.get("/callback", validateRequest(dpoCallbackSchema), dpoController.callback);
router.post("/callback", validateRequest(dpoCallbackSchema), dpoController.callback);

module.exports = router;
