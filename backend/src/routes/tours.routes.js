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
// Staff: show or hide products on the public site.
router.get("/admin/products", authenticate, authorize("super_admin", "admin"), toursController.listProductsForAdmin);
router.patch("/admin/products/:productId/visibility", authenticate, authorize("super_admin", "admin"), toursController.setProductVisibility);
router.get("/:id/options", toursController.getTourOptions);
router.get("/:slug/available-dates", toursController.getAvailableDates);
router.post("/:slug/options-availability", toursController.checkOptionsAvailability);
router.get("/:slug", toursController.getTourBySlug);
router.post("/sync", authenticate, authorize("super_admin", "admin", "staff"), toursController.syncProducts);

module.exports = router;
