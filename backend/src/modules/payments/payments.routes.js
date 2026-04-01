const express = require("express");
const paymentsController = require("./payments.controller");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");
const pesapalRoutes = require("./pesapal/pesapal.routes");

const router = express.Router();

router.use("/pesapal", pesapalRoutes);
router.get("/", authenticate, authorize("super_admin", "admin", "staff"), paymentsController.listPayments);

module.exports = router;
