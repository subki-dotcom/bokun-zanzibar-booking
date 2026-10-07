import { formatCurrency } from "../../../utils/formatters";
import { pricePresentation } from "./pricePresentation";

const resolveModeLabel = ({ mode = "", summary = "" }) => {
  const token = `${mode} ${summary}`.toLowerCase();

  if (token.includes("live_total") || token.includes("live total")) {
    return "Live total";
  }

  if (token.includes("group")) {
    return "Per group";
  }

  if (
    token.includes("person") ||
    token.includes("adult") ||
    token.includes("child") ||
    token.includes("pax")
  ) {
    return "Per person";
  }

  return "Live rates";
};

const PriceDisplay = ({ amount = 0, currency = "USD", summary = "", mode = "", compact = false, pricingType = "", maxPerBooking = null }) => {
  const hasNumericPrice = Number(amount) > 0;
  const modeLabel = mode === "live_total" && pricingType !== "per_group"
    ? "Total for selected passengers"
    : pricePresentation({ pricingType, maxPerBooking }).label || resolveModeLabel({ mode, summary });
  const summaryText = String(summary || "").trim();

  return (
    <div className={`single-tour-price ${compact ? "is-compact" : ""}`.trim()}>
      <div className="single-tour-price-label">{hasNumericPrice ? mode === "live_total" ? "Total" : "From" : "Price summary"}</div>
      <div className="single-tour-price-value">
        {hasNumericPrice ? formatCurrency(amount, currency) : summaryText || "Live pricing and availability"}
      </div>
      <div className="single-tour-price-meta">{modeLabel}</div>
    </div>
  );
};

export default PriceDisplay;
