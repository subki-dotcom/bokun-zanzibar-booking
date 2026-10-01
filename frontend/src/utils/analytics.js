import { createAnalytics } from './analyticsCore';
const env = import.meta.env;
const analytics = createAnalytics({ measurementId: env.VITE_GA_MEASUREMENT_ID,
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
export const trackBookingFormStarted = () => analytics.event('booking_form_started', {}, `form:${globalThis.history?.state?.key}:${globalThis.location?.pathname}`);
export const tourData = (tour = {}) => {
  const price = tour.fromPrice;
  const hasPrice = typeof price === 'number' && Number.isFinite(price) && price >= 0 && /^[A-Z]{3}$/.test(tour.currency || '');
  return { ...(hasPrice ? { currency: tour.currency, value: price } : {}),
    items: [{ item_id: tour.bokunProductId || tour.id || tour.slug, item_name: tour.title,
      item_category: 'Tour', quantity: 1, ...(hasPrice ? { price } : {}) }] };
};
