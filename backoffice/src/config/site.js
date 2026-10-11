// The public website handles password recovery and the agent portal.
const PROD_WEBSITE_URL = "https://zanzibartoursandsafaris.co.tz";
const DEV_WEBSITE_URL = "http://localhost:5173";

export const WEBSITE_URL = String(
  import.meta.env.VITE_WEBSITE_URL || (import.meta.env.PROD ? PROD_WEBSITE_URL : DEV_WEBSITE_URL)
).replace(/\/+$/, "");
