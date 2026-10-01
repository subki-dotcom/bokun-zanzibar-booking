// Read-only projection. Never infer purchase eligibility from a return URL.
const buildPurchaseAnalytics = (booking, config = {}) => {
  const paid = booking?.pendingCheckout;
  const provider = paid?.paymentProvider;
  if (booking?.isTest || booking?.testMode) return null;
  if (config.BOKUN_MOCK_MODE || config[`${String(provider).toUpperCase()}_MOCK_MODE`]) return null;
  if (!['pesapal', 'paypal', 'dpo'].includes(provider)) return null;
  if (/sandbox|demo|test/i.test(String(config[`${provider.toUpperCase()}_BASE_URL`] || ''))) return null;
  if (booking?.sourceChannel !== 'direct_website' || booking.agentId || booking.createdByRole !== 'customer') return null;
  if (booking.paymentStatus !== 'paid' || booking.bookingStatus === 'cancelled') return null;
  if (!paid.paymentVerifiedAt || !paid.paymentTransactionId || /mock|test/i.test(paid.paymentTransactionId)) return null;
  if (booking.amountRefunded > 0 || ['refunded', 'partially_refunded'].includes(booking.refundStatus)) return null;
  const value = paid.paidAmount;
  const currency = paid.paidCurrency;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !/^[A-Z]{3}$/.test(currency || '')) return null;
  if (!booking.bookingReference || !booking.bokunProductId || !booking.productTitle) return null;
  return {
    transaction_id: booking.bookingReference,
    currency, value,
    items: [{ item_id: String(booking.bokunProductId), item_name: booking.productTitle,
      item_category: 'Tour', price: value, quantity: 1 }]
  };
};
module.exports = { buildPurchaseAnalytics };
