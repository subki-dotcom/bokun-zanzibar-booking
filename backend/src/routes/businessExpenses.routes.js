const express = require("express");
const businessExpensesController = require("../controllers/businessExpenses.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const { PERMISSIONS } = require("../security/permissions");
const validateRequest = require("../middleware/validateRequest");
const {
  createBusinessExpenseSchema,
  listBusinessExpenseSchema,
  updateBusinessExpenseSchema,
  supplierPaymentSchema,
  expenseIdParamsSchema
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
router.get(
  "/:id/posting-preview",
  authorizePermission(PERMISSIONS.BUSINESS_EXPENSE_READ),
  businessExpensesController.previewPosting
);
router.post(
  "/supplier-payments",
  authorizePermission(PERMISSIONS.RECORD_SUPPLIER_PAYMENT),
  validateRequest(supplierPaymentSchema),
  businessExpensesController.createSupplierPayment
);
router.post(
  "/:id/approve",
  authorizePermission(PERMISSIONS.APPROVE_EXPENSE),
  validateRequest(expenseIdParamsSchema),
  businessExpensesController.approve
);
router.post(
  "/:id/post",
  authorizePermission(PERMISSIONS.POST_EXPENSE),
  businessExpensesController.post
);
router.post(
  "/:id/reverse",
  authorizePermission(PERMISSIONS.REVERSE_EXPENSE),
  validateRequest(expenseIdParamsSchema),
  businessExpensesController.reverse
);

module.exports = router;
