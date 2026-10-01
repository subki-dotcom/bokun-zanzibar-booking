export const isBackendPaymentVerified = (booking) =>
  String(booking?.paymentStatus || '').toLowerCase() === 'paid';

export const getPurchaseProjection = (booking) =>
  isBackendPaymentVerified(booking) && booking?.analyticsPurchase
    ? booking.analyticsPurchase
    : null;