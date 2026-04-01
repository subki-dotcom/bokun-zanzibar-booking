const express = require("express");

const authRoutes = require("../modules/auth/auth.routes");
const usersRoutes = require("../modules/users/users.routes");
const bokunRoutes = require("../modules/bokun/bokun.routes");
const toursRoutes = require("../modules/tours/tours.routes");
const bookingsRoutes = require("../modules/bookings/bookings.routes");
const customersRoutes = require("../modules/customers/customers.routes");
const invoicesRoutes = require("../modules/invoices/invoices.routes");
const agentsRoutes = require("../modules/agents/agents.routes");
const commissionsRoutes = require("../modules/commissions/commissions.routes");
const offersRoutes = require("../modules/offers/offers.routes");
const paymentsRoutes = require("../modules/payments/payments.routes");
const webhooksRoutes = require("../modules/webhooks/webhooks.routes");
const reportsRoutes = require("../modules/reports/reports.routes");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/bokun", bokunRoutes);
router.use("/tours", toursRoutes);
router.use("/bookings", bookingsRoutes);
router.use("/customers", customersRoutes);
router.use("/invoices", invoicesRoutes);
router.use("/agents", agentsRoutes);
router.use("/commissions", commissionsRoutes);
router.use("/offers", offersRoutes);
router.use("/payments", paymentsRoutes);
router.use("/webhooks", webhooksRoutes);
router.use("/reports", reportsRoutes);

module.exports = router;