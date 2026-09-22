const Booking = require('../../models/Booking');
const { loadSettlementViews } = require('./settlementView');
const { toDecimal } = require('../../utils/money');
const FIELDS = 'bookingReference bokunBookingId operationalSource salesChannel paymentStatus bookingPaymentStatus bookingPaymentStatusSource bookingPaymentReportedAmount bookingPaymentCurrency bookingPaymentStatusSyncedAt bookingPaymentConflict';
const bokunLinked = booking => Boolean(booking?.bokunBookingId || booking?.operationalSource === 'BOKUN');
const presentBookingPayment = (booking = {}, now = new Date()) => {
  const isBokun = bokunLinked(booking);
  const hasCanonical = isBokun ? ['BOKUN', 'MANUAL_OVERRIDE'].includes(booking.bookingPaymentStatusSource) : Boolean(booking.bookingPaymentStatusSource);
  const legacy = { paid: 'PAID', partial: 'PARTIALLY_PAID', pending: 'UNPAID', refunded: 'REFUNDED' };
  const syncedAt = booking.bookingPaymentStatusSyncedAt ? new Date(booking.bookingPaymentStatusSyncedAt).toISOString() : null;
  return {
    status: hasCanonical ? booking.bookingPaymentStatus : isBokun ? 'UNKNOWN' : legacy[booking.paymentStatus] || 'UNKNOWN',
    source: hasCanonical ? booking.bookingPaymentStatusSource : isBokun ? 'BOKUN' : 'LOCAL',
    reportedPaidAmount: booking.bookingPaymentReportedAmount == null ? null : Number(toDecimal(booking.bookingPaymentReportedAmount).toFixed()),
    currency: booking.bookingPaymentCurrency || null,
    syncedAt, stale: isBokun && (!syncedAt || now - new Date(syncedAt) > 24 * 60 * 60 * 1000),
    conflict: Boolean(booking.bookingPaymentConflict),
    requiresBackfill: isBokun && !hasCanonical
  };
};
const enrichPaymentViews = async (rows = []) => {
  const refs = [...new Set(rows.map(row => row.bookingReference).filter(Boolean))];
  if (!refs.length) return rows;
  const [bookings, settlements] = await Promise.all([
    Booking.find({ bookingReference: { $in: refs } }).select(FIELDS).lean(),
    loadSettlementViews(refs, new Map(rows.map(row => [row.bookingReference, { currency: row.currency || row.accountingCurrency }])))
  ]);
  const byReference = new Map(bookings.map(booking => [booking.bookingReference, booking]));
  return rows.map(row => {
    const booking = byReference.get(row.bookingReference);
    return { ...row, bookingPayment: presentBookingPayment(booking || {}),
      salesChannel: booking?.salesChannel || '',
      guestPaymentCollector: row.guestPaymentCollector || '',
      settlement: settlements.get(row.bookingReference),
      cashReceipt: settlements.get(row.bookingReference)?.cashReceipt,
      accountingPaymentStatus: row.paymentStatus,
      accountingBalanceMeaning: 'Local accounting balance; not necessarily money due from the traveler.' };
  });
};
module.exports = { presentBookingPayment, enrichPaymentViews, bokunLinked, FIELDS };
