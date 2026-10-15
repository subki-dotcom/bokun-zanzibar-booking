// The public website handles password recovery and the agent portal.
const PROD_WEBSITE_URL = "https://zanzibartoursandsafaris.co.tz";
const DEV_WEBSITE_URL = "http://localhost:5173";

export const WEBSITE_URL = String(
  import.meta.env.VITE_WEBSITE_URL || (import.meta.env.PROD ? PROD_WEBSITE_URL : DEV_WEBSITE_URL)
).replace(/\/+$/, "");

// Where the full Back Office runs, for links from the website's /admin to Back-Office-only sections.
// Set VITE_BACK_OFFICE_URL for production; without it, production shows the message without a link.
const DEV_BACK_OFFICE_URL = "http://localhost:5174";

export const BACK_OFFICE_URL = String(
  import.meta.env.VITE_BACK_OFFICE_URL || (import.meta.env.PROD ? "" : DEV_BACK_OFFICE_URL)
).replace(/\/+$/, "");

// The Transfer Admin app (its own login). Shown as a link in the website's /admin menu.
// Set VITE_TRANSFER_ADMIN_URL for production; without it, the link is hidden there.
const DEV_TRANSFER_ADMIN_URL = "http://localhost:5175";

export const TRANSFER_ADMIN_URL = String(
  import.meta.env.VITE_TRANSFER_ADMIN_URL || (import.meta.env.PROD ? "" : DEV_TRANSFER_ADMIN_URL)
).replace(/\/+$/, "");
