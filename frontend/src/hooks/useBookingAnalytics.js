import { useEffect } from 'react';
import { fetchBookingByReference } from '../api/bookingsApi';
import { initializeAnalytics, trackPurchase, trackAnalyticsEvent } from '../utils/analytics';
import { getPurchaseProjection, isBackendPaymentVerified } from '../utils/purchaseProjection';

// Only API-returned state, never query-string status flags.
export default function useBookingAnalytics(booking, reference = '') {
  useEffect(() => {
    let active = true;
    const report = async () => {
      try {
        if (!booking || !initializeAnalytics()) return;
        if (booking.isAgentBooking || (booking.sourceChannel && booking.sourceChannel !== 'direct_website')) return;
        const ref = booking.bookingReference || reference;
        const projection = getPurchaseProjection(booking);
        if (projection) { await trackPurchase(projection); return; }
        if (isBackendPaymentVerified(booking) && ref) {
          const full = await fetchBookingByReference(ref);
          const fullProjection = getPurchaseProjection(full);
          if (active && fullProjection) await trackPurchase(fullProjection);
        }
        if (booking.bookingStatus === 'cancelled') trackAnalyticsEvent('booking_cancelled', {}, `cancel:${ref}`);
        else if (booking.paymentStatus === 'failed') trackAnalyticsEvent('booking_failed', {
          failure_stage: 'payment_verification', error_category: 'payment_failed'
        }, `failure:${ref}`);
        else if (booking.paymentStatus === 'paid' && booking.bookingStatus !== 'confirmed') {
          trackAnalyticsEvent('booking_processing', {}, `processing:${ref}`);
        }
      } catch { /* analytics cannot change the booking UI */ }
    };
    void report();
    window.addEventListener('riser:analytics-consent', report);
    return () => { active = false; window.removeEventListener('riser:analytics-consent', report); };
  }, [booking, reference]);
}
