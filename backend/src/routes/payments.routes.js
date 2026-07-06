const express = require("express");
const paymentsController = require("../controllers/payments.controller");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");
const pesapalRoutes = require("./payments/pesapal.routes");
const dpoRoutes = require("./payments/dpo.routes");

const router = express.Router();

router.use("/pesapal", pesapalRoutes);
router.use("/dpo", dpoRoutes);
router.get("/", authenticate, authorize("super_admin", "admin", "staff"), paymentsController.listPayments);

module.exports = router;
