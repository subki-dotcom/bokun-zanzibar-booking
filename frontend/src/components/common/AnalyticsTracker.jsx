import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackPageView, updateAnalyticsConsent, suspendAnalytics } from "../../utils/analytics";

const AnalyticsTracker = () => {
  const location = useLocation();

  useEffect(() => {
    const page = () => trackPageView(`${location.key}:${location.pathname}`);
    const timer = window.setTimeout(page, 0);
    const consent = (event) => updateAnalyticsConsent(event.detail);
    // WhatsApp / phone / email clicks: utils/clickTracking.js (one listener for the whole site).
    window.addEventListener('zts:consent-update', consent);
    window.addEventListener('zts:analytics-consent', page);
    return () => {
      suspendAnalytics();
      clearTimeout(timer);
      window.removeEventListener('zts:consent-update', consent);
      window.removeEventListener('zts:analytics-consent', page);
    };
  }, [location.key, location.pathname]);

  return null;
};

export default AnalyticsTracker;
