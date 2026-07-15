const express = require("express");
const toursController = require("../controllers/tours.controller");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");
const validateRequest = require("../middleware/validateRequest");
const { availabilitySearchSchema } = require("../validators/tours.validation");

const router = express.Router();

router.get("/", toursController.listTours);
router.get("/categories", toursController.listCategories);
router.post("/availability-search", validateRequest(availabilitySearchSchema), toursController.searchToursByAvailability);
router.get("/:id/options", toursController.getTourOptions);
router.post("/:slug/options-availability", toursController.checkOptionsAvailability);
router.get("/:slug", toursController.getTourBySlug);
router.post("/sync", authenticate, authorize("super_admin", "admin", "staff"), toursController.syncProducts);

module.exports = router;
