import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackPageView, trackAnalyticsEvent, updateAnalyticsConsent, suspendAnalytics } from "../../utils/analytics";

const AnalyticsTracker = () => {
  const location = useLocation();

  useEffect(() => {
    const page = () => trackPageView(`${location.key}:${location.pathname}`);
    const timer = window.setTimeout(page, 0);
    const consent = (event) => updateAnalyticsConsent(event.detail);
    const click = (event) => {
      const anchor = event.target.closest?.('a[href]');
      if (!anchor) return;
      let name;
      try {
        const url = new URL(anchor.href);
        if (url.protocol === 'tel:') name = 'phone_click';
        else if (url.protocol === 'mailto:') name = 'email_click';
        else if (['wa.me', 'api.whatsapp.com', 'web.whatsapp.com'].includes(url.hostname)) name = 'whatsapp_click';
      } catch { return; }
      if (name) trackAnalyticsEvent(name, { link_location: 'public_site' });
    };
    window.addEventListener('riser:consent-update', consent);
    window.addEventListener('riser:analytics-consent', page);
    document.addEventListener('click', click);
    return () => {
      suspendAnalytics();
      clearTimeout(timer);
      window.removeEventListener('riser:consent-update', consent);
      window.removeEventListener('riser:analytics-consent', page);
      document.removeEventListener('click', click);
    };
  }, [location.key, location.pathname]);

  return null;
};

export default AnalyticsTracker;
