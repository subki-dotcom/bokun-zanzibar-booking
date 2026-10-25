import { createAnalytics } from './analyticsCore';
const env = import.meta.env;
const analytics = createAnalytics({ measurementId: env.VITE_GA_MEASUREMENT_ID,
  gtmId: 'GTM-PF7LKQ72',
  adsId: env.VITE_GOOGLE_ADS_ID, adsLabel: env.VITE_GOOGLE_ADS_BOOKING_LABEL,
  directAds: env.VITE_GOOGLE_ADS_DIRECT_CONVERSIONS === 'true', production: env.PROD,
  debug: env.VITE_ANALYTICS_DEBUG === 'true' });
export const initializeAnalytics = analytics.initialize;
export const suspendAnalytics = analytics.suspend;
export const updateAnalyticsConsent = analytics.consent;
export const trackAnalyticsEvent = analytics.event;
export const trackPageView = analytics.page;
export const trackPurchase = analytics.purchase;
export const trackViewItem = (tour) => analytics.event('view_item', tourData(tour), `view:${globalThis.history?.state?.key}:${globalThis.location?.pathname}`);
export const trackSelectItem = (tour) => analytics.event('select_item', tourData(tour));
// Funnel steps on the tour page. Sent only with analytics consent (analytics.event checks it).
const guests = (count) => (Number.isInteger(count) && count > 0 ? { number_of_guests: count } : {});
export const trackSelectTravelers = (tour, guestCount) => analytics.event('select_travelers', { ...tourData(tour), ...guests(guestCount) });
export const trackSelectDate = (tour, guestCount) => analytics.event('select_date', { ...tourData(tour), ...guests(guestCount) });
export const trackCheckAvailability = (tour, guestCount) => analytics.event('check_availability', { ...tourData(tour), ...guests(guestCount) });
export const trackSelectOption = (tour, guestCount) => analytics.event('select_option', { ...tourData(tour), ...guests(guestCount) });
export const trackBookingFormStarted = () => analytics.event('booking_form_started', {}, `form:${globalThis.history?.state?.key}:${globalThis.location?.pathname}`);
export const tourData = (tour = {}) => {
  const price = tour.fromPrice;
  const hasPrice = typeof price === 'number' && Number.isFinite(price) && price >= 0 && /^[A-Z]{3}$/.test(tour.currency || '');
  return { ...(hasPrice ? { currency: tour.currency, value: price } : {}),
    items: [{ item_id: tour.bokunProductId || tour.id || tour.slug, item_name: tour.title,
      item_category: 'Tour', quantity: 1, ...(hasPrice ? { price } : {}) }] };
};
