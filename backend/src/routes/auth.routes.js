const express = require("express");
const authController = require("../controllers/auth.controller");
const validateRequest = require("../middleware/validateRequest");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");
const { changePasswordSchema, loginSchema, registerAdminSchema, registerAgentSchema } = require("../validators/auth.validation");
const { passwordChangeLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

router.post("/login", validateRequest(loginSchema), authController.login);
router.post(
  "/change-password",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  passwordChangeLimiter,
  validateRequest(changePasswordSchema),
  authController.changePassword
);
router.post("/register-agent", validateRequest(registerAgentSchema), authController.registerAgent);
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
