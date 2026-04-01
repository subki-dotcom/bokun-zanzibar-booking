const express = require("express");
const usersController = require("./users.controller");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");

const router = express.Router();

router.get("/", authenticate, authorize("super_admin", "admin"), usersController.listUsers);

module.exports = router;