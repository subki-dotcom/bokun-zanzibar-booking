const express = require("express");
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
