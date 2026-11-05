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
  const decimals = code === "TZS" ? 0 : 2;
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
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", ...(plain ? { timeZone: "UTC" } : {}) });
};

export const formatAdminDateTime = (value) => {
  const date = toDate(value);
  if (!date) return "—";
  const day = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day}, ${time}`;
};
