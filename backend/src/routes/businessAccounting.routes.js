const express = require("express");
const businessAccountingController = require("../controllers/businessAccounting.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const { PERMISSIONS } = require("../security/permissions");
const validateRequest = require("../middleware/validateRequest");
const {
  accountsReceivableQuerySchema,
  accountsPayableQuerySchema,
  bookingFinancialFactsSchema,
  authoritativeFinancialSummarySchema,
  foundationQuerySchema,
  postBookingContributionSchema
} = require("../validators/businessAccounting.validation");

const router = express.Router();

router.use(authenticate);

router.get(
  "/accounts-receivable",
  authorizePermission(PERMISSIONS.BUSINESS_ACCOUNTING_READ),
  validateRequest(accountsReceivableQuerySchema),
  businessAccountingController.accountsReceivable
);

router.get(
  "/accounts-payable",
  authorizePermission(PERMISSIONS.BUSINESS_ACCOUNTING_READ),
  validateRequest(accountsPayableQuerySchema),
  businessAccountingController.accountsPayable
);

router.get(
  "/foundation",
  authorizePermission(PERMISSIONS.BUSINESS_ACCOUNTING_READ),
  validateRequest(foundationQuerySchema),
  businessAccountingController.foundation
);

router.get(
  "/bookings/:bookingReference/financial-facts",
  authorizePermission(PERMISSIONS.BUSINESS_ACCOUNTING_READ),
  validateRequest(bookingFinancialFactsSchema),
  businessAccountingController.bookingFinancialFacts
);

router.get(
  "/authoritative-summary",
  authorizePermission(PERMISSIONS.BUSINESS_ACCOUNTING_READ),
  validateRequest(authoritativeFinancialSummarySchema),
  businessAccountingController.authoritativeFinancialSummary
);

router.post(
  "/postings/bookings/:bookingReference",
  authorizePermission(PERMISSIONS.BUSINESS_ACCOUNTING_WRITE),
  validateRequest(postBookingContributionSchema),
  businessAccountingController.postBookingContribution
);

module.exports = router;
