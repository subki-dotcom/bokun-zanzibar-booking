import dayjs from "dayjs";

export const formatCurrency = (amount = 0, currency = "USD") => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(Number(amount || 0));
};

export const formatDate = (value, format = "MMM D, YYYY") => {
  if (!value) return "-";
  return dayjs(value).format(format);
};

export const statusBadgeVariant = (status) => {
  switch (status) {
    case "confirmed":
    case "paid":
      return "success";
    case "pending":
      return "warning";
    case "cancelled":
    case "failed":
      return "danger";
    default:
      return "secondary";
  }
};

export const toPlainText = (value = "") => {
  return String(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
};

export const truncateText = (value = "", maxLength = 220) => {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trim()}...`;
};
