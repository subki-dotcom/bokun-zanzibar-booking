const express = require("express");
const authController = require("./auth.controller");
const validateRequest = require("../../middleware/validateRequest");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");
const { loginSchema, registerAdminSchema } = require("./auth.validation");

const router = express.Router();

router.post("/login", validateRequest(loginSchema), authController.login);
router.post(
  "/register-admin",
  (req, _res, next) => {
    if (req.headers.authorization) {
      return authenticate(req, _res, next);
    }

    return next();
  },
  (req, _res, next) => {
    if (req.auth) {
      return authorize("super_admin")(req, _res, next);
    }

    return next();
  },
  validateRequest(registerAdminSchema),
  authController.registerAdmin
);
router.get("/me", authenticate, authController.me);

module.exports = router;