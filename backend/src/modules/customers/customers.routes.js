const express = require("express");
const customersController = require("./customers.controller");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");

const router = express.Router();

router.get("/", authenticate, authorize("super_admin", "admin", "staff"), customersController.listCustomers);
router.get(
  "/:id",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  customersController.getCustomer
);

module.exports = router;