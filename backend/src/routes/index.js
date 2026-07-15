const express = require("express");

const authRoutes = require("./auth.routes");
const usersRoutes = require("./users.routes");
const bokunRoutes = require("./bokun.routes");
const toursRoutes = require("./tours.routes");
const bookingsRoutes = require("./bookings.routes");
const customersRoutes = require("./customers.routes");
const invoicesRoutes = require("./invoices.routes");
const agentsRoutes = require("./agents.routes");
const commissionsRoutes = require("./commissions.routes");
const offersRoutes = require("./offers.routes");
const paymentsRoutes = require("./payments.routes");
const webhooksRoutes = require("./webhooks.routes");
const reportsRoutes = require("./reports.routes");
const marketingRoutes = require("./marketing.routes");
const reviewsRoutes = require("./reviews.routes");
const bookingRequestsRoutes = require("./bookingRequests.routes");
const adminBookingRequestsRoutes = require("./adminBookingRequests.routes");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/bokun", bokunRoutes);
router.use("/tours", toursRoutes);
router.use("/bookings", bookingsRoutes);
router.use("/customers", customersRoutes);
router.use("/invoices", invoicesRoutes);
router.use("/agent", agentsRoutes);
router.use("/agents", agentsRoutes);
router.use("/commissions", commissionsRoutes);
router.use("/offers", offersRoutes);
router.use("/payments", paymentsRoutes);
router.use("/webhooks", webhooksRoutes);
router.use("/reports", reportsRoutes);
router.use("/marketing", marketingRoutes);
router.use("/reviews", reviewsRoutes);
router.use("/", bookingRequestsRoutes);
router.use("/admin", adminBookingRequestsRoutes);

module.exports = router;
