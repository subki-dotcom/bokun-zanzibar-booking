const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const noStore = require("../middleware/noStore");
const validateRequest = require("../middleware/validateRequest");
const { PERMISSIONS } = require("../security/permissions");
const schemas = require("../validators/financeEscalations.validation");
const financeEscalations = require("../services/financeEscalations");

// Finance escalation queue (read-only). Guarded by the existing Finance read permission behind Booking
// Accounting (super_admin, admin, staff). tour_admin and agents do not hold it; customer access tokens
// are not sessions. There are deliberately no write routes here.
const router = express.Router();
router.use(noStore, authenticate, authorizePermission(PERMISSIONS.BOOKING_ACCOUNTING_READ));

router.get("/", validateRequest(schemas.listEscalationsSchema), asyncHandler(async (req, res) =>
  successResponse(res, { message: "Finance escalations fetched", data: await financeEscalations.listEscalations({ filters: req.validated.query || {} }) })));

router.get("/:id", validateRequest(schemas.escalationIdSchema), asyncHandler(async (req, res) =>
  successResponse(res, { message: "Finance escalation fetched", data: await financeEscalations.getEscalation({ requestId: req.validated.params.id }) })));

module.exports = router;
