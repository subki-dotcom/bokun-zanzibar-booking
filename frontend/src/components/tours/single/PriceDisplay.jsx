import { formatCurrency } from "../../../utils/formatters";

const resolveModeLabel = ({ mode = "", summary = "" }) => {
  const token = `${mode} ${summary}`.toLowerCase();

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

const PriceDisplay = ({ amount = 0, currency = "USD", summary = "", mode = "", compact = false }) => {
  const hasNumericPrice = Number(amount) > 0;
  const modeLabel = resolveModeLabel({ mode, summary });
  const summaryText = String(summary || "").trim();

  return (
    <div className={`single-tour-price ${compact ? "is-compact" : ""}`.trim()}>
      <div className="single-tour-price-label">{hasNumericPrice ? "Starting from" : "Price summary"}</div>
      <div className="single-tour-price-value">
        {hasNumericPrice ? formatCurrency(amount, currency) : summaryText || "Live pricing and availability"}
      </div>
      <div className="single-tour-price-meta">{modeLabel}</div>
    </div>
  );
};

export default PriceDisplay;
