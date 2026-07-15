const express = require("express");
const reviewsController = require("../controllers/reviews.controller");

const router = express.Router();
router.get("/", reviewsController.listPublicReviews);

module.exports = router;
