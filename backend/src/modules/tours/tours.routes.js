const express = require("express");
const toursController = require("./tours.controller");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");

const router = express.Router();

router.get("/", toursController.listTours);
router.get("/categories", toursController.listCategories);
router.get("/:id/options", toursController.getTourOptions);
router.post("/:slug/options-availability", toursController.checkOptionsAvailability);
router.get("/:slug", toursController.getTourBySlug);
router.post("/sync", authenticate, authorize("super_admin", "admin", "staff"), toursController.syncProducts);

module.exports = router;
