// Plain-English labels for technical values shown in the admin ("GETYOURGUIDE" → "GetYourGuide",
// "confirmed_booking_import" → "Confirmed booking import"). The raw value stays available for a tooltip.
const KNOWN = {
  getyourguide: "GetYourGuide",
  viator: "Viator",
  bokun: "Bókun",
  bokun_marketplace: "Bókun marketplace",
  direct_website: "Direct website",
  website: "Website",
  whatsapp: "WhatsApp",
  tourhq: "TourHQ",
  airbnb: "Airbnb",
  ota_channel: "OTA channel",
  ota: "OTA",
  b2b: "B2B",
  agent: "Agent / B2B",
  pesapal: "Pesapal",
  dpo: "DPO",
  paypal: "PayPal",
  usd: "USD",
  tzs: "TZS",
  eur: "EUR",
  gl: "GL",
  ar: "AR",
  ap: "AP",
  crm: "CRM",
  csv: "CSV",
  pdf: "PDF",
  api: "API",
  fx: "FX",
  id: "ID",
  url: "URL",
  sms: "SMS",
  local_operator_confirmation: "Local operator confirmation",
  no_completed_backup: "No completed backup yet",
  confirmed_booking_import: "Confirmed booking import",
  confirmed_booking_resync: "Confirmed booking resync",
  booking_sync: "Booking sync",
  products_sync: "Product sync",
  webhook_update: "Webhook update",
  crm_lead_created: "Lead created",
  awaiting_settlement_data: "Awaiting settlement data",
  needs_review_fx: "Needs FX review",
  partially_paid: "Partially paid",
  review_required: "Review required",
  not_configured: "Not set up",
  supplier_pending: "Waiting for supplier",
  pending_retry: "Will retry",
  in_progress: "In progress"
};

const ACRONYMS = new Set(["gl", "ar", "ap", "crm", "csv", "pdf", "api", "fx", "id", "url", "sms", "ota", "b2b", "usd", "tzs", "eur", "kpi", "vat", "tin"]);

export const formatLabel = (value = "") => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return formatLabel(value.label || value.name || value.code || "");
  const raw = String(value).trim();
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (KNOWN[key]) return KNOWN[key];
  // Already human text (has lowercase letters and spaces, no underscores): keep it.
  if (/[a-z]/.test(raw) && /\s/.test(raw) && !raw.includes("_")) return raw;
  const words = raw.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[_\s.-]+/).filter(Boolean);
  if (!words.length) return raw;
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      if (KNOWN[lower]) return KNOWN[lower];
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
};

// The raw value, for a title= tooltip next to a formatted label (empty when the label already is the value).
export const rawLabelTitle = (value = "") => {
  const raw = value && typeof value === "object" ? value.code || "" : String(value ?? "");
  return raw && formatLabel(value) !== raw ? raw : undefined;
};
