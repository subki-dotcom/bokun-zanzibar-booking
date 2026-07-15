const MARKETING_ATTRIBUTION_KEY = "riser_marketing_attribution_v1";

const cleanValue = (value = "", maxLength = 180) => String(value || "").trim().slice(0, maxLength);

export const readMarketingAttribution = () => {
  try {
    const value = JSON.parse(localStorage.getItem(MARKETING_ATTRIBUTION_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
};

export const persistMarketingAttribution = (search = "") => {
  const params = new URLSearchParams(search);
  const incoming = {
    referralCode: cleanValue(params.get("ref"), 64).toUpperCase(),
    utmSource: cleanValue(params.get("utm_source")),
    utmMedium: cleanValue(params.get("utm_medium")),
    utmCampaign: cleanValue(params.get("utm_campaign")),
    utmTerm: cleanValue(params.get("utm_term")),
    utmContent: cleanValue(params.get("utm_content"))
  };
  const hasIncoming = Object.values(incoming).some(Boolean);
  if (!hasIncoming) return readMarketingAttribution();

  const next = {
    ...readMarketingAttribution(),
    ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => Boolean(value))),
    capturedAt: new Date().toISOString()
  };
  try {
    localStorage.setItem(MARKETING_ATTRIBUTION_KEY, JSON.stringify(next));
  } catch {
    // Attribution must never block booking.
  }
  return next;
};

export const buildMarketingContext = (search = "") => {
  const attribution = persistMarketingAttribution(search);
  return {
    ...attribution,
    landingPage: typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "",
    referrer: typeof document !== "undefined" ? cleanValue(document.referrer, 400) : ""
  };
};
