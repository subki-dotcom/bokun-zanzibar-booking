const express = require("express");
const businessExpensesController = require("../controllers/businessExpenses.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const { PERMISSIONS } = require("../security/permissions");
const validateRequest = require("../middleware/validateRequest");
const {
  createBusinessExpenseSchema,
  listBusinessExpenseSchema,
  updateBusinessExpenseSchema
} = require("../validators/businessAccounting.validation");

const router = express.Router();

router.use(authenticate);

router.get(
  "/",
  authorizePermission(PERMISSIONS.BUSINESS_EXPENSE_READ),
  validateRequest(listBusinessExpenseSchema),
  businessExpensesController.list
);
router.post(
  "/",
  authorizePermission(PERMISSIONS.BUSINESS_EXPENSE_WRITE),
  validateRequest(createBusinessExpenseSchema),
  businessExpensesController.create
);
router.patch(
  "/:id",
  authorizePermission(PERMISSIONS.BUSINESS_EXPENSE_WRITE),
  validateRequest(updateBusinessExpenseSchema),
  businessExpensesController.update
);

module.exports = router;
