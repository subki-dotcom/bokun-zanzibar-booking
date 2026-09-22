const express = require("express");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const validateRequest = require("../middleware/validateRequest");
const { PERMISSIONS } = require("../security/permissions");
const controller = require("../controllers/settlements.controller");
const schemas = require("../validators/settlements.validation");

const router = express.Router();
router.use(authenticate, authorizePermission(PERMISSIONS.SETTLEMENT_VIEW));
router.get("/", validateRequest(schemas.listSettlementsSchema), controller.list);
router.post("/import/preview", authorizePermission(PERMISSIONS.SETTLEMENT_IMPORT), validateRequest(schemas.importPreviewSchema), controller.importPreview);
router.post("/import/commit", authorizePermission(PERMISSIONS.SETTLEMENT_IMPORT), validateRequest(schemas.importCommitSchema), controller.importCommit);
router.get("/:settlementId", controller.detail);
router.post("/", authorizePermission(PERMISSIONS.SETTLEMENT_CREATE), validateRequest(schemas.createSettlementSchema), controller.create);
router.post("/:settlementId/allocate", authorizePermission(PERMISSIONS.SETTLEMENT_ALLOCATE), validateRequest(schemas.allocationSchema), controller.allocate);
router.post("/:settlementId/reconcile", authorizePermission(PERMISSIONS.SETTLEMENT_RECONCILE), validateRequest(schemas.reconcileSchema), controller.reconcile);
router.post("/allocations/:allocationId/reverse", authorizePermission(PERMISSIONS.SETTLEMENT_ALLOCATE), validateRequest(schemas.reverseAllocationSchema), controller.reverseAllocation);
module.exports = router;