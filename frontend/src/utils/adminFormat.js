// Shared admin number, money and date formats: "USD 1,080.00", "1,234", "05 Nov 2026", "05 Nov 2026, 00:32".
const numberFormat = new Intl.NumberFormat("en-US");

export const formatAdminNumber = (value) => {
  const number = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(number) ? "—" : numberFormat.format(number);
};

export const formatAdminMoney = (value, currency = "USD") => {
  const number = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return "—";
  const code = /^[A-Z]{3}$/.test(String(currency || "")) ? currency : "USD";
  // TZS is shown without decimals unless the amount has cents, so no value is ever rounded away.
  const decimals = code === "TZS" && Number.isInteger(Math.round(number * 100) / 100) ? 0 : 2;
  return `${code} ${number.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
};

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatAdminDate = (value) => {
  const date = toDate(value);
  if (!date) return "—";
  // Plain calendar dates ("2026-11-05") are shown as that day, whatever the browser's time zone.
  const plain = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  // Some browsers write September as "Sept"; every month is three letters here.
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", ...(plain ? { timeZone: "UTC" } : {}) }).replace("Sept", "Sep");
};

export const formatAdminDateTime = (value) => {
  const date = toDate(value);
  if (!date) return "—";
  const day = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace("Sept", "Sep");
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day}, ${time}`;
};

// Drop-in replacements for utils/formatters on admin pages (same arguments): money as "USD 1,080.00" (missing
// amounts count as 0, as before), dates as "05 Nov 2026" or, when the old pattern had a time, "05 Nov 2026, 00:32".
export const formatCurrency = (amount = 0, currency = "USD") => formatAdminMoney(Number(amount || 0), currency || "USD");

export const formatDate = (value, pattern = "MMM D, YYYY") => {
  if (!value) return "—";
  return /[Hh]/.test(String(pattern)) ? formatAdminDateTime(value) : formatAdminDate(value);
};
