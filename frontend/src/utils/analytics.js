const measurementId = String(import.meta.env.VITE_GA_MEASUREMENT_ID || "").trim();

export const initializeAnalytics = () => {
  if (!measurementId || typeof window === "undefined" || window.__riserAnalyticsInitialized) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", measurementId, { send_page_view: false });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
  window.__riserAnalyticsInitialized = true;
};

export const trackAnalyticsEvent = (eventName, parameters = {}) => {
  if (!measurementId || typeof window === "undefined") return;
  window.gtag?.("event", eventName, parameters);
};
