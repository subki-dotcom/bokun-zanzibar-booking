const express = require("express");
const offersController = require("./offers.controller");
const validateRequest = require("../../middleware/validateRequest");
const { createOfferSchema } = require("./offers.validation");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");

const router = express.Router();

router.get("/", authenticate, authorize("super_admin", "admin", "staff"), offersController.listOffers);
router.post(
  "/",
  authenticate,
  authorize("super_admin", "admin"),
  validateRequest(createOfferSchema),
  offersController.createOffer
);

module.exports = router;