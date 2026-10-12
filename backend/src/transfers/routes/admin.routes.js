const express = require("express");
const AppError = require("../../utils/AppError");
const validateRequest = require("../../middleware/validateRequest");
const asyncHandler = require("../../utils/asyncHandler");
const { successResponse } = require("../../utils/apiResponse");
const { requestContext } = require("../services/audit");
const { createTransferAuthenticate, requireTransferPermission, transferLoginLimiter } = require("../middleware/auth");
const { TRANSFER_PERMISSIONS: P } = require("../security/permissions");
const v = require("../validators");

// Transfer Admin API, mounted at /api/transfer-admin. Every route except login needs a Transfer Admin token.
const createTransferAdminRouter = ({ getStore, tokenConfig, services }) => {
  const router = express.Router();
  const authenticate = createTransferAuthenticate({ getStore, tokenConfig });
  const can = requireTransferPermission;
  const actor = (req) => req.transferAuth;
  const body = (req) => req.validated.body;
  const ok = (res, data, statusCode = 200, meta = {}) => successResponse(res, { data, statusCode, meta });

  router.post("/auth/login", transferLoginLimiter, validateRequest(v.loginSchema), asyncHandler(async (req, res) =>
    ok(res, await services.auth.login({ ...body(req), context: requestContext(req) }))));

  router.use(authenticate);

  router.get("/auth/me", asyncHandler(async (req, res) => ok(res, await services.auth.me({ actor: actor(req) }))));
  router.post("/auth/change-password", validateRequest(v.changePasswordSchema), asyncHandler(async (req, res) =>
    ok(res, await services.auth.changePassword({ actor: actor(req), ...body(req), context: requestContext(req) }))));
  router.post("/auth/logout-everywhere", validateRequest(v.emptyBodySchema), asyncHandler(async (req, res) =>
    ok(res, await services.auth.logoutEverywhere({ actor: actor(req), context: requestContext(req) }))));

  // Pricing catalogue
  const catalog = services.catalog;
  const list = (fn) => [validateRequest(v.listSchema), asyncHandler(async (req, res) => ok(res, await fn({ query: req.query })))];
  const write = (schema, fn, statusCode = 200) => [
    validateRequest(schema),
    asyncHandler(async (req, res) => ok(res, await fn({ actor: actor(req), context: requestContext(req), input: body(req), ...req.validated.params }), statusCode))
  ];

  router.get("/zones", can(P.PRICING_VIEW), ...list(catalog.listZones));
  router.post("/zones", can(P.PRICING_MANAGE), ...write(v.createZoneSchema, catalog.createZone, 201));
  router.patch("/zones/:zoneId", can(P.PRICING_MANAGE), ...write(v.updateZoneSchema, catalog.updateZone));

  router.get("/locations", can(P.PRICING_VIEW), ...list(catalog.listLocations));
  router.post("/locations", can(P.PRICING_MANAGE), ...write(v.createLocationSchema, catalog.createLocation, 201));
  router.patch("/locations/:locationId", can(P.PRICING_MANAGE), ...write(v.updateLocationSchema, catalog.updateLocation));

  router.get("/routes", can(P.PRICING_VIEW), ...list(catalog.listRoutes));
  router.post("/routes", can(P.PRICING_MANAGE), ...write(v.createRouteSchema, catalog.createRoute, 201));
  router.patch("/routes/:routeId", can(P.PRICING_MANAGE), ...write(v.updateRouteSchema, catalog.updateRoute));

  router.get("/rates", can(P.PRICING_VIEW), ...list(catalog.listRates));
  router.post("/rates", can(P.PRICING_MANAGE), ...write(v.createRateSchema, catalog.createRate, 201));
  router.patch("/rates/:rateId", can(P.PRICING_MANAGE), ...write(v.updateRateSchema, catalog.updateRate));

  router.get("/settings/pricing", can(P.PRICING_VIEW), asyncHandler(async (_req, res) => ok(res, await catalog.getSettings())));
  router.patch("/settings/pricing", can(P.PRICING_MANAGE), ...write(v.updateSettingsSchema, catalog.updateSettings));

  // Price preview: the same calculation the website will use, priced from the database.
  router.post("/pricing/preview", can(P.PRICING_VIEW), validateRequest(v.quoteSchema), asyncHandler(async (req, res) =>
    ok(res, await services.pricing.quote(body(req)))));

  // Dashboard and bookings
  const bookingsAdmin = services.adminBookings;
  const params = (req) => req.validated.params;
  const seesFleet = (req) => req.transferAuth.permissions.includes(P.FLEET_VIEW);
  router.get("/dashboard", can(P.BOOKINGS_VIEW), asyncHandler(async (req, res) => {
    const data = await bookingsAdmin.dashboard();
    // Dispatch figures include driver names, so they are shown to users who may see the fleet.
    if (seesFleet(req)) data.dispatch = await services.dispatch.dashboardSection();
    return ok(res, data);
  }));
  router.get("/bookings", can(P.BOOKINGS_VIEW), validateRequest(v.listSchema), asyncHandler(async (req, res) => ok(res, await bookingsAdmin.list({ query: req.query }))));
  router.get("/bookings/:bookingId", can(P.BOOKINGS_VIEW), validateRequest(v.bookingIdSchema), asyncHandler(async (req, res) =>
    ok(res, {
      ...(await bookingsAdmin.get({ bookingId: params(req).bookingId, actor: actor(req) })),
      ...(seesFleet(req) ? { trips: await services.dispatch.tripsForBooking({ bookingId: params(req).bookingId }) } : {})
    })));
  // Transfer Admin never creates bookings and never takes cash on arrival: bookings come only from the website and
  // are paid online. The retired endpoints answer 410 for every role, and each attempt is kept in the audit log.
  const retired = (action, code, message) => asyncHandler(async (req) => {
    await bookingsAdmin.recordRefusedAction({ actor: actor(req), action, bookingId: req.params.bookingId, context: requestContext(req) });
    throw new AppError(message, 410, code);
  });
  router.post("/bookings", retired("booking.create_refused", "TRANSFER_ADMIN_BOOKING_CREATION_DISABLED", "Transfer Admin cannot create bookings. Bookings are made by customers on the website and paid online."));
  router.post("/bookings/:bookingId/quote", can(P.BOOKINGS_MANAGE), validateRequest(v.bookingQuoteSchema), asyncHandler(async (req, res) =>
    ok(res, await bookingsAdmin.setQuote({ actor: actor(req), bookingId: params(req).bookingId, input: body(req), context: requestContext(req) }))));
  router.post("/bookings/:bookingId/approve-cash-on-arrival", retired("booking.cash_on_arrival_refused", "TRANSFER_CASH_ON_ARRIVAL_DISABLED", "Cash on arrival is not available. Bookings are paid online and confirmed only after the payment is verified."));
  router.post("/bookings/:bookingId/reject", can(P.BOOKINGS_MANAGE), validateRequest(v.bookingReasonSchema), asyncHandler(async (req, res) =>
    ok(res, await bookingsAdmin.reject({ actor: actor(req), bookingId: params(req).bookingId, input: body(req), context: requestContext(req) }))));
  router.post("/bookings/:bookingId/customer-link", can(P.BOOKINGS_MANAGE), validateRequest(v.bookingIdSchema), asyncHandler(async (req, res) =>
    ok(res, await bookingsAdmin.customerLink({ actor: actor(req), bookingId: params(req).bookingId, context: requestContext(req) }))));

  // Drivers and vehicles
  const fleet = services.fleet;
  router.get("/drivers", can(P.FLEET_VIEW), ...list(fleet.listDrivers));
  router.post("/drivers", can(P.FLEET_MANAGE), ...write(v.createDriverSchema, fleet.createDriver, 201));
  router.patch("/drivers/:driverId", can(P.FLEET_MANAGE), ...write(v.updateDriverSchema, fleet.updateDriver));
  router.get("/drivers/:driverId/history", can(P.FLEET_VIEW), validateRequest(v.driverIdSchema), asyncHandler(async (req, res) => ok(res, await fleet.driverHistory(params(req)))));
  router.get("/vehicles", can(P.FLEET_VIEW), ...list(fleet.listVehicles));
  router.post("/vehicles", can(P.FLEET_MANAGE), ...write(v.createVehicleSchema, fleet.createVehicle, 201));
  router.patch("/vehicles/:vehicleId", can(P.FLEET_MANAGE), ...write(v.updateVehicleSchema, fleet.updateVehicle));
  router.get("/vehicles/:vehicleId/history", can(P.FLEET_VIEW), validateRequest(v.vehicleIdSchema), asyncHandler(async (req, res) => ok(res, await fleet.vehicleHistory(params(req)))));

  // Dispatch
  const dispatch = services.dispatch;
  const tripAction = (schema, fn) => [validateRequest(schema), asyncHandler(async (req, res) =>
    ok(res, await fn({ actor: actor(req), tripId: params(req).tripId, input: body(req), context: requestContext(req) })))];
  router.get("/dispatch/trips", can(P.FLEET_VIEW), validateRequest(v.listSchema), asyncHandler(async (req, res) => ok(res, await dispatch.listTrips({ query: req.query }))));
  router.get("/dispatch/trips/:tripId", can(P.FLEET_VIEW), validateRequest(v.tripIdSchema), asyncHandler(async (req, res) => ok(res, await dispatch.getTrip(params(req)))));
  router.post("/dispatch/trips/:tripId/assign", can(P.DISPATCH_MANAGE), ...tripAction(v.assignTripSchema, dispatch.assign));
  router.post("/dispatch/trips/:tripId/unassign", can(P.DISPATCH_MANAGE), ...tripAction(v.unassignTripSchema, dispatch.unassign));
  router.post("/dispatch/trips/:tripId/status", can(P.DISPATCH_MANAGE), ...tripAction(v.tripStatusSchema, dispatch.changeStatus));

  // Users
  router.get("/users", can(P.USERS_MANAGE), asyncHandler(async (_req, res) => ok(res, await services.users.list())));
  router.post("/users", can(P.USERS_MANAGE), validateRequest(v.createUserSchema), asyncHandler(async (req, res) =>
    ok(res, await services.users.create({ actor: actor(req), context: requestContext(req), input: body(req) }), 201)));
  router.patch("/users/:userId", can(P.USERS_MANAGE), validateRequest(v.updateUserSchema), asyncHandler(async (req, res) =>
    ok(res, await services.users.update({ actor: actor(req), context: requestContext(req), userId: req.validated.params.userId, input: body(req) }))));
  router.post("/users/:userId/reset-password", can(P.USERS_MANAGE), validateRequest(v.resetPasswordSchema), asyncHandler(async (req, res) =>
    ok(res, await services.users.resetPassword({ actor: actor(req), context: requestContext(req), userId: req.validated.params.userId, ...body(req) }))));

  // Audit trail
  router.get("/audit-logs", can(P.AUDIT_VIEW), validateRequest(v.listSchema), asyncHandler(async (req, res) =>
    ok(res, await services.audit.list({ query: req.query }))));

  return router;
};

module.exports = { createTransferAdminRouter };
