const Booking = require("../../models/Booking");
const CommissionRecord = require("../../models/CommissionRecord");
const ProductSnapshot = require("../../models/ProductSnapshot");
const SyncLog = require("../../models/SyncLog");

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

module.exports = {
  getDashboardSummary,
  dailyBookings,
  monthlySales,
  performanceReports
};
