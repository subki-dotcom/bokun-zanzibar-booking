import { BsDash, BsPeople, BsPlus } from "react-icons/bs";

const formatAgeRange = (category = {}) => {
  if (!category.ageQualified) {
    return "";
  }

  const minAge = Number(category.minAge);
  const maxAge = Number(category.maxAge);
  const hasMinAge = Number.isFinite(minAge) && minAge >= 0;
  const hasMaxAge = Number.isFinite(maxAge) && maxAge >= 0;

  if (hasMinAge && hasMaxAge) {
    return `Ages ${minAge}-${maxAge}`;
  }

  if (hasMinAge) {
    return `Ages ${minAge}+`;
  }

  return hasMaxAge ? `Up to age ${maxAge}` : "";
};

const PassengerCategorySelector = ({
  categories = [],
  passengers = [],
  disabled = false,
  onChangeQuantity
}) => {
  const quantityByCategoryId = new Map(
    (passengers || []).map((row) => [String(row.pricingCategoryId || ""), Number(row.quantity || 0)])
  );

  return (
    <div>
      <div className="single-booking-inline-label">Passengers</div>
      <div className="passenger-category-grid">
        {categories.map((category) => {
          const categoryId = String(category.id || "");
          const quantity = Number(quantityByCategoryId.get(categoryId) ?? category.defaultQuantity ?? 0);
          const min = Math.max(0, Number(category.min || 0));
          const max = Math.max(min, Number(category.max || 50));
          const ageRange = formatAgeRange(category);

          return (
            <div key={categoryId} className="single-booking-select-wrap passenger-select-wrap passenger-stepper-row">
              <BsPeople className="single-booking-input-icon" />
              <span className="passenger-stepper-label">
                <span>{category.label} x {quantity}</span>
                {ageRange ? <small>{ageRange}</small> : null}
              </span>
              <div className="passenger-stepper-actions">
                <button type="button" disabled={disabled || quantity <= min} onClick={() => onChangeQuantity?.(categoryId, quantity - 1)} aria-label={`Decrease ${category.label} passengers`}><BsDash /></button>
                <button type="button" disabled={disabled || quantity >= max} onClick={() => onChangeQuantity?.(categoryId, quantity + 1)} aria-label={`Increase ${category.label} passengers`}><BsPlus /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PassengerCategorySelector;
