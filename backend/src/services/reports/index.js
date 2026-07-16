const Booking = require("../../models/Booking");
const CommissionRecord = require("../../models/CommissionRecord");
const ProductSnapshot = require("../../models/ProductSnapshot");
const SyncLog = require("../../models/SyncLog");
const MarketingLead = require("../../models/MarketingLead");
const EmailDelivery = require("../../models/EmailDelivery");
const BookingRequest = require("../../models/BookingRequest");
const mongoose = require("mongoose");
const {
  env,
  isBokunConfigured,
  isDpoConfigured,
  isPesapalConfigured,
  isPaypalConfigured,
  isEmailConfigured
} = require("../../config/env");

const countDistinctLeadStage = async (stage) => {
  const rows = await MarketingLead.aggregate([
    { $unwind: "$journey" },
    { $match: { "journey.stage": stage } },
    { $group: { _id: "$email" } },
    { $count: "count" }
  ]);
  return Number(rows[0]?.count || 0);
};

const getDashboardSummary = async () => {
  const [kpis, topProducts, topAgents, sourceBreakdown, syncLogs] = await Promise.all([
    Promise.all([
      Booking.countDocuments({}),
      Booking.countDocuments({ bookingStatus: "confirmed" }),
      Booking.countDocuments({ bookingStatus: "cancelled" }),
      Booking.aggregate([{ $group: { _id: null, sales: { $sum: "$pricingSnapshot.finalPayable" } } }])
    ]),
    Booking.aggregate([
      {
        $group: {
          _id: "$productTitle",
          bookings: { $sum: 1 },
          sales: { $sum: "$pricingSnapshot.finalPayable" }
        }
      },
      { $sort: { sales: -1 } },
      { $limit: 5 }
    ]),
    CommissionRecord.aggregate([
      {
        $group: {
          _id: "$agentId",
          commissionAmount: { $sum: "$commissionAmount" },
          bookings: { $sum: 1 }
        }
      },
      { $sort: { commissionAmount: -1 } },
      { $limit: 5 }
    ]),
    Booking.aggregate([
      {
        $group: {
          _id: "$sourceChannel",
          count: { $sum: 1 },
          sales: { $sum: "$pricingSnapshot.finalPayable" }
        }
      }
    ]),
    SyncLog.find({
      operation: { $in: ["products_sync", "booking_sync", "webhook_update"] }
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean()
  ]);

  return {
    kpis: {
      totalBookings: kpis[0],
      confirmedBookings: kpis[1],
      cancelledBookings: kpis[2],
      totalSales: Number(kpis[3][0]?.sales || 0),
      totalProducts: await ProductSnapshot.countDocuments({})
    },
    topProducts,
    topAgents,
    sourceBreakdown,
    syncLogs
  };
};

const dailyBookings = async () => {
  return Booking.aggregate([
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
        },
        bookings: { $sum: 1 },
        sales: { $sum: "$pricingSnapshot.finalPayable" }
      }
    },
    { $sort: { _id: -1 } },
    { $limit: 30 }
  ]);
};

const monthlySales = async () => {
  return Booking.aggregate([
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m", date: "$createdAt" }
        },
        sales: { $sum: "$pricingSnapshot.finalPayable" },
        bookings: { $sum: 1 }
      }
    },
    { $sort: { _id: -1 } },
    { $limit: 12 }
  ]);
};

const performanceReports = async () => {
  const [productPerformance, optionPerformance, agentPerformance, unpaidCommissions, paymentStatusSummary, cancellationSummary] =
    await Promise.all([
      Booking.aggregate([
        {
          $group: {
            _id: "$productTitle",
            bookings: { $sum: 1 },
            sales: { $sum: "$pricingSnapshot.finalPayable" }
          }
        },
        { $sort: { sales: -1 } }
      ]),
      Booking.aggregate([
        {
          $group: {
            _id: "$optionTitle",
            bookings: { $sum: 1 },
            sales: { $sum: "$pricingSnapshot.finalPayable" }
          }
        },
        { $sort: { sales: -1 } }
      ]),
      CommissionRecord.aggregate([
        {
          $group: {
            _id: "$agentId",
            commissionAmount: { $sum: "$commissionAmount" },
            bookings: { $sum: 1 }
          }
        },
        { $sort: { commissionAmount: -1 } }
      ]),
      CommissionRecord.find({ payoutStatus: "unpaid" }).lean(),
      Booking.aggregate([
        {
          $group: {
            _id: "$paymentStatus",
            count: { $sum: 1 }
          }
        }
      ]),
      Booking.aggregate([
        {
          $group: {
            _id: "$bookingStatus",
            count: { $sum: 1 }
          }
        }
      ])
    ]);

  return {
    productPerformance,
    optionPerformance,
    agentPerformance,
    unpaidCommissions,
    paymentStatusSummary,
    cancellationSummary
  };
};

const conversionFunnel = async () => {
  const [newsletterSubscribers, checkoutContacts, paymentStarted, bookingsCreated, paidBookings, confirmedBookings] = await Promise.all([
    MarketingLead.countDocuments({ subscriptionStatus: "subscribed" }),
    countDistinctLeadStage("checkout_customer"),
    countDistinctLeadStage("checkout_payment_started"),
    Booking.countDocuments({}),
    Booking.countDocuments({ paymentStatus: "paid" }),
    Booking.countDocuments({ bookingStatus: "confirmed" })
  ]);
  const steps = [
    { key: "checkout_contact", label: "Checkout contact details", count: checkoutContacts },
    { key: "payment_started", label: "Payment started", count: paymentStarted },
    { key: "booking_created", label: "Booking created", count: bookingsCreated },
    { key: "payment_paid", label: "Payment paid", count: paidBookings },
    { key: "supplier_confirmed", label: "Supplier confirmed", count: confirmedBookings }
  ];

  return {
    newsletterSubscribers,
    steps: steps.map((step, index) => ({
      ...step,
      conversionRate: index === 0 || steps[index - 1].count === 0
        ? null
        : Number(((step.count / steps[index - 1].count) * 100).toFixed(1))
    }))
  };
};

const getOperationalAlerts = async () => {
  const [paidPendingSupplier, failedPayments, failedEmailDeliveries] = await Promise.all([
    Booking.find({
      paymentStatus: "paid",
      $or: [{ bokunBookingId: "" }, { bokunBookingId: { $exists: false } }]
    })
      .sort({ updatedAt: -1 })
      .limit(12)
      .lean(),
    Booking.find({ paymentStatus: "failed" })
      .sort({ updatedAt: -1 })
      .limit(8)
      .lean(),
    EmailDelivery.find({ status: "failed" })
      .sort({ updatedAt: -1 })
      .limit(8)
      .lean()
  ]);

  const alerts = [
    ...paidPendingSupplier.map((booking) => ({
      id: `supplier-${booking._id}`,
      severity: "warning",
      type: "supplier_confirmation_pending",
      title: "Paid booking needs supplier confirmation",
      description: `${booking.productTitle || "Booking"} is paid but Bokun has not confirmed it yet.`,
      bookingReference: booking.bookingReference,
      createdAt: booking.updatedAt
    })),
    ...failedPayments.map((booking) => ({
      id: `payment-${booking._id}`,
      severity: "danger",
      type: "payment_failed",
      title: "Payment failed",
      description: `${booking.productTitle || "Booking"} needs a customer follow-up or a new payment attempt.`,
      bookingReference: booking.bookingReference,
      createdAt: booking.updatedAt
    })),
    ...failedEmailDeliveries.map((delivery) => ({
      id: `email-${delivery._id}`,
      severity: "danger",
      type: "email_failed",
      title: "Transactional email failed",
      description: `${delivery.templateKey || "Booking"} email could not be delivered.`,
      bookingReference: delivery.bookingReference,
      createdAt: delivery.updatedAt
    }))
  ].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));

  return {
    counts: {
      paidPendingSupplier: paidPendingSupplier.length,
      failedPayments: failedPayments.length,
      failedEmailDeliveries: failedEmailDeliveries.length
    },
    alerts
  };
};

const getGrowthPerformance = async () => {
  const [campaigns, referrals] = await Promise.all([
    Booking.aggregate([
      { $match: { "pricingSnapshot.discountAmount": { $gt: 0 } } },
      {
        $group: {
          _id: { $ifNull: ["$pendingCheckout.checkoutPayload.promoCode", "Automatic campaign"] },
          bookings: { $sum: 1 },
          sales: { $sum: "$pricingSnapshot.finalPayable" },
          discount: { $sum: "$pricingSnapshot.discountAmount" }
        }
      },
      { $sort: { bookings: -1, sales: -1 } },
      { $limit: 10 }
    ]),
    Booking.aggregate([
      { $match: { "marketing.referralCode": { $type: "string", $ne: "" } } },
      {
        $group: {
          _id: "$marketing.referralCode",
          bookings: { $sum: 1 },
          sales: { $sum: "$pricingSnapshot.finalPayable" }
        }
      },
      { $sort: { bookings: -1, sales: -1 } },
      { $limit: 10 }
    ])
  ]);

  return { campaigns, referrals };
};

const databaseStateLabel = (readyState) => {
  const labels = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting"
  };

  return labels[readyState] || "unknown";
};

const getOperationsOverview = async () => {
  const [paidPendingSupplier, retriableFinalizations, failedEmails, openBookingRequests, latestSync] = await Promise.all([
    Booking.countDocuments({
      paymentStatus: "paid",
      $or: [{ bokunBookingId: "" }, { bokunBookingId: { $exists: false } }]
    }),
    Booking.countDocuments({
      paymentStatus: "paid",
      "pendingCheckout.finalization.status": { $in: ["pending_retry", "failed"] }
    }),
    EmailDelivery.countDocuments({ status: "failed" }),
    BookingRequest.countDocuments({ status: { $in: ["submitted", "under_review", "awaiting_customer"] } }),
    SyncLog.findOne({ operation: { $in: ["products_sync", "booking_sync", "webhook_update"] } })
      .sort({ createdAt: -1 })
      .lean()
  ]);

  const databaseConnected = mongoose.connection.readyState === 1;
  const bokunMode = env.BOKUN_MOCK_MODE ? "test" : isBokunConfigured ? "live" : "unavailable";
  const paymentProviders = [
    {
      id: "pesapal",
      label: "Pesapal",
      mode: env.PESAPAL_MOCK_MODE ? "test" : isPesapalConfigured ? "live" : "unavailable"
    },
    {
      id: "dpo",
      label: "DPO",
      mode: env.DPO_MOCK_MODE ? "test" : isDpoConfigured ? "live" : "unavailable",
      note:
        !env.DPO_MOCK_MODE && isDpoConfigured && !env.DPO_CALLBACK_URL
          ? "Set DPO_CALLBACK_URL to enable server callback verification."
          : ""
    },
    {
      id: "paypal",
      label: "PayPal",
      mode: env.PAYPAL_MOCK_MODE ? "test" : isPaypalConfigured ? "live" : "unavailable",
      note:
        !env.PAYPAL_MOCK_MODE && isPaypalConfigured && !env.PAYPAL_WEBHOOK_ID
          ? "Set PAYPAL_WEBHOOK_ID to verify PayPal webhooks."
          : ""
    }
  ];
  const liveProviders = paymentProviders.filter((provider) => provider.mode === "live").length;
  const hasCriticalIssue =
    !databaseConnected ||
    (env.NODE_ENV === "production" && bokunMode !== "live") ||
    (env.NODE_ENV === "production" && liveProviders === 0);
  const hasWarnings =
    paidPendingSupplier > 0 ||
    retriableFinalizations > 0 ||
    failedEmails > 0 ||
    openBookingRequests > 0 ||
    bokunMode !== "live" ||
    !isEmailConfigured ||
    paymentProviders.some((provider) => Boolean(provider.note));

  return {
    status: hasCriticalIssue ? "critical" : hasWarnings ? "warning" : "healthy",
    generatedAt: new Date().toISOString(),
    runtime: {
      environment: env.NODE_ENV,
      uptimeSeconds: Number(process.uptime().toFixed(0)),
      database: {
        status: databaseStateLabel(mongoose.connection.readyState),
        healthy: databaseConnected
      }
    },
    integrations: [
      {
        id: "bokun",
        label: "Bokun supplier",
        mode: bokunMode,
        healthy: bokunMode === "live"
      },
      ...paymentProviders.map((provider) => ({
        ...provider,
        healthy: provider.mode === "live"
      })),
      {
        id: "email",
        label: "Transactional email",
        mode: isEmailConfigured ? "live" : "unavailable",
        healthy: isEmailConfigured
      }
    ],
    jobs: [
      {
        id: "booking_finalization",
        label: "Paid booking finalization retry",
        enabled: Boolean(env.BOOKING_FINALIZATION_RETRY_ENABLED),
        intervalSeconds: Number(env.BOOKING_FINALIZATION_RETRY_INTERVAL_SECONDS)
      },
      {
        id: "bokun_sync",
        label: "Bokun booking sync fallback",
        enabled: Boolean(env.BOKUN_BOOKING_SYNC_ENABLED),
        intervalSeconds: Number(env.BOKUN_BOOKING_SYNC_INTERVAL_SECONDS)
      }
    ],
    queue: {
      paidPendingSupplier,
      retriableFinalizations,
      failedEmails,
      openBookingRequests,
      latestBokunSync: latestSync
        ? {
            status: latestSync.status,
            operation: latestSync.operation,
            completedAt: latestSync.completedAt || latestSync.updatedAt || latestSync.createdAt
          }
        : null
    }
  };
};

module.exports = {
  getDashboardSummary,
  dailyBookings,
  monthlySales,
  performanceReports,
  conversionFunnel,
  getOperationalAlerts,
  getGrowthPerformance,
  getOperationsOverview
};
