const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const noStore = require("../middleware/noStore");
const validateRequest = require("../middleware/validateRequest");
const { PERMISSIONS } = require("../security/permissions");
const schemas = require("../validators/tourOperations.validation");
const tourOperations = require("../services/tourOperations");

// Tour Operations API. Every route is permission-checked here; the role that holds these
// permissions (tour_admin) has no other permission, so it is refused everywhere else.
const router = express.Router();
router.use(noStore, authenticate);

const canReadBookings = authorizePermission(PERMISSIONS.TOUR_OPERATIONS_READ);
const canReadRequests = authorizePermission(PERMISSIONS.TOUR_REQUESTS_READ);
const canProcessRequests = authorizePermission(PERMISSIONS.TOUR_REQUESTS_PROCESS);

router.get("/bookings", canReadBookings, validateRequest(schemas.listBookingsSchema), asyncHandler(async (req, res) =>
  successResponse(res, { message: "Tour bookings fetched", data: await tourOperations.listBookings({ filters: req.validated.query || {} }) })));

router.get("/requests", canReadRequests, validateRequest(schemas.listRequestsSchema), asyncHandler(async (req, res) =>
  successResponse(res, { message: "Tour booking requests fetched", data: await tourOperations.listRequests({ filters: req.validated.query || {} }) })));

router.get("/requests/:id", canReadRequests, validateRequest(schemas.requestIdSchema), asyncHandler(async (req, res) =>
  successResponse(res, { message: "Tour booking request fetched", data: await tourOperations.getRequest({ requestId: req.validated.params.id }) })));

router.post("/requests/:id/notes", canProcessRequests, validateRequest(schemas.noteSchema), asyncHandler(async (req, res) =>
  successResponse(res, {
    message: "Internal note added",
    data: await tourOperations.addNote({ requestId: req.validated.params.id, auth: req.auth, text: req.validated.body.text })
  })));

router.post("/requests/:id/transition", canProcessRequests, validateRequest(schemas.transitionSchema), asyncHandler(async (req, res) =>
  successResponse(res, {
    message: "Operations state updated",
    data: await tourOperations.transition({
      requestId: req.validated.params.id,
      auth: req.auth,
      toState: req.validated.body.toState,
      expectedVersion: req.validated.body.expectedVersion,
      reason: req.validated.body.reason || ""
    })
  })));

router.post("/requests/:id/category", canProcessRequests, validateRequest(schemas.categorySchema), asyncHandler(async (req, res) =>
  successResponse(res, {
    message: "Request category updated",
    data: await tourOperations.setCategory({
      requestId: req.validated.params.id,
      auth: req.auth,
      category: req.validated.body.category,
      expectedVersion: req.validated.body.expectedVersion
    })
  })));

module.exports = router;
