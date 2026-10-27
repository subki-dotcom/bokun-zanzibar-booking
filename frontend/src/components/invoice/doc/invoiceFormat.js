// Pure formatting for the invoice page (mockups "Invoice" and "InvoiceMobile"); the PDF uses the same rules.
const ZANZIBAR_OFFSET_MS = 3 * 60 * 60 * 1000;

// "$45.00"
export const money = (amount, currency = "USD") => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount || 0));
  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
};

const toLocal = (value) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return new Date(`${value}T12:00:00Z`);
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms + ZANZIBAR_OFFSET_MS) : null;
};

// "27 Oct 2026" (a date, or an instant in Zanzibar time)
export const docDate = (value) => {
  const date = toLocal(value);
  return date ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
};

// "27 Oct 2026, 10:14 (Zanzibar time)"
export const docDateTime = (value) => {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  return `${docDate(value)}, ${new Date(ms + ZANZIBAR_OFFSET_MS).toISOString().slice(11, 16)} (Zanzibar time)`;
};

// "Mon, 30 Nov 2026"
export const weekdayDate = (date) => {
  const value = toLocal(date);
  if (!value) return "";
  return `${value.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}, ${docDate(date)}`;
};

// "Mon, 30 Nov 2026 · 09:00 (Zanzibar time)"
export const tripWhen = (trip = {}) =>
  [weekdayDate(trip.date), trip.startTime ? `${trip.startTime} (Zanzibar time)` : ""].filter(Boolean).join(" · ");

// "30 Nov 2026 · 09:00 · 1 × Adult" (the phone items card)
export const mobileItemLine = (doc = {}, item = {}) => {
  const category = String(item.subDescription || "").split(" · ").slice(1).join(" · ");
  return [docDate(doc.trip?.date), doc.trip?.startTime, category ? `${item.qty} × ${category}` : `${item.qty} ×`].filter(Boolean).join(" · ");
};

// "Card via Pesapal · Visa •••• 1234"
export const paymentMethodLine = (payment = {}) =>
  [payment.method, payment.brand && payment.last4 ? `${payment.brand} •••• ${payment.last4}` : payment.brand].filter(Boolean).join(" · ");

// The last meta cell: what was paid, or what is still due.
export const amountCell = (doc = {}) => {
  if (doc.kind === "credit_note") return { label: "Amount credited", value: `${money(doc.total, doc.currency)} ${doc.currency}` };
  return doc.balanceDue > 0
    ? { label: "Amount due", value: `${money(doc.balanceDue, doc.currency)} ${doc.currency}`, due: true }
    : { label: "Amount paid", value: `${money(doc.amountPaid, doc.currency)} ${doc.currency}` };
};

export const documentTitle = (doc = {}) => (doc.kind === "credit_note" ? "Credit note" : "Invoice");

export const companyLines = (company = {}) =>
  [
    company.legalName && company.legalName !== company.name ? company.legalName : "",
    company.address || "",
    [company.phone, company.email].filter(Boolean).join(" · "),
    company.website || "",
    [company.tin ? `TIN: ${company.tin}` : "", company.licence ? `Licence: ${company.licence}` : ""].filter(Boolean).join(" · ")
  ].filter(Boolean);
