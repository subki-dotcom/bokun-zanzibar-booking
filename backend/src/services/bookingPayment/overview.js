const Booking = require('../../models/Booking');
const { resolveAnalyticsPeriod } = require('../../analytics/periods');
const getPaymentOverview = async (filters = {}) => {
  const period = resolveAnalyticsPeriod(filters);
  const match = { $or: [{ bokunBookingId: { $type: 'string', $ne: '' } }, { operationalSource: 'BOKUN' }] };
  if (period.isBounded) match.createdAt = { $gte: period.from, $lt: period.to };
  if (filters.channel) match.salesChannel = filters.channel;
  const channels = await Booking.aggregate([
    { $match: match },
    { $lookup: { from: 'payments', localField: 'bookingReference', foreignField: 'bookingReference', as: 'localPayments', pipeline: [{ $match: { verificationStatus: 'verified' } }, { $project: { provider: 1, settledAt: 1 } }] } },
    { $lookup: { from: 'paymentallocations', localField: 'bookingReference', foreignField: 'bookingReference', as: 'allocations', pipeline: [{ $match: { status: 'applied' } }, { $project: { paymentId: 1 } }] } },
    { $project: { salesChannel: 1, payment: { $cond: [{ $in: ['$bookingPaymentStatusSource', ['BOKUN', 'MANUAL_OVERRIDE']] }, '$bookingPaymentStatus', 'UNKNOWN'] },
      received: { $anyElementTrue: [{ $map: { input: '$localPayments', as: 'p', in: { $or: [
        { $eq: [{ $type: '$$p.settledAt' }, 'date'] },
        { $and: [{ $in: ['$$p.provider', ['manual_bank', 'cash_on_arrival']] }, { $in: ['$$p._id', '$allocations.paymentId'] }] }
      ] } } }] } } },
    { $group: { _id: { $ifNull: ['$salesChannel', 'OTHER'] }, total: { $sum: 1 },
      paid: { $sum: { $cond: [{ $eq: ['$payment', 'PAID'] }, 1, 0] } },
      partiallyPaid: { $sum: { $cond: [{ $eq: ['$payment', 'PARTIALLY_PAID'] }, 1, 0] } },
      unpaid: { $sum: { $cond: [{ $eq: ['$payment', 'UNPAID'] }, 1, 0] } },
      refunded: { $sum: { $cond: [{ $eq: ['$payment', 'REFUNDED'] }, 1, 0] } },
      unknown: { $sum: { $cond: [{ $in: ['$payment', ['PAID', 'PARTIALLY_PAID', 'UNPAID', 'REFUNDED']] }, 0, 1] } },
      settlementReceived: { $sum: { $cond: ['$received', 1, 0] } },
      settlementPending: { $sum: { $cond: ['$received', 0, 1] } }
    } }, { $sort: { total: -1, _id: 1 } }
  ]);
  return { period, channels: channels.map(({ _id, ...row }) => ({ channel: _id, ...row, settlementReconciled: null })),
    totals: channels.reduce((sum, row) => { for (const key of ['total', 'paid', 'partiallyPaid', 'unpaid', 'refunded', 'unknown', 'settlementReceived', 'settlementPending']) sum[key] = (sum[key] || 0) + row[key]; return sum; }, { total: 0, paid: 0, partiallyPaid: 0, unpaid: 0, refunded: 0, unknown: 0, settlementReceived: 0, settlementPending: 0 }),
    reconciliationRate: null, reconciliationSupported: false,
    basis: 'Bokun-linked bookings created locally in the selected period. Settlement received means evidence of a dated local settlement or verified applied cash/bank receipt; it does not prove full channel payout.' };
};
module.exports = { getPaymentOverview };
