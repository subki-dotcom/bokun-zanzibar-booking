import { formatPriceLabel } from "./listing.helpers";

const TourPriceDisplay = ({ fromPrice = 0, currency = "USD", pricingType = "per_person" }) => {
  const price = formatPriceLabel({ fromPrice, currency, pricingType });

  return (
    <div className="tour-price-display">
      <span className="tour-price-heading">{price.heading}</span>
      <span className="tour-price-subtext">{price.subtext}</span>
    </div>
  );
};

export default TourPriceDisplay;
