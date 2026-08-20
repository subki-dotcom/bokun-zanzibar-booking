const express = require("express");
const businessIncomeController = require("../controllers/businessIncome.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const { PERMISSIONS } = require("../security/permissions");
const validateRequest = require("../middleware/validateRequest");
const {
  createBusinessIncomeSchema,
  listBusinessIncomeSchema,
  updateBusinessIncomeSchema
} = require("../validators/businessAccounting.validation");

const router = express.Router();

router.use(authenticate);

router.get(
  "/",
  authorizePermission(PERMISSIONS.BUSINESS_INCOME_READ),
  validateRequest(listBusinessIncomeSchema),
  businessIncomeController.list
);
router.post(
  "/",
  authorizePermission(PERMISSIONS.BUSINESS_INCOME_WRITE),
  validateRequest(createBusinessIncomeSchema),
  businessIncomeController.create
);
router.patch(
  "/:id",
  authorizePermission(PERMISSIONS.BUSINESS_INCOME_WRITE),
  validateRequest(updateBusinessIncomeSchema),
  businessIncomeController.update
);

module.exports = router;
