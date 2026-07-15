import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { initializeAnalytics, trackAnalyticsEvent } from "../../utils/analytics";

const AnalyticsTracker = () => {
  const location = useLocation();

  useEffect(() => {
    initializeAnalytics();
    trackAnalyticsEvent("page_view", {
      page_path: `${location.pathname}${location.search}`,
      page_title: document.title
    });
  }, [location.pathname, location.search]);

  return null;
};

export default AnalyticsTracker;
