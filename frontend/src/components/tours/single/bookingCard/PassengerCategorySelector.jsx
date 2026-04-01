import Form from "react-bootstrap/Form";
import { BsPeople } from "react-icons/bs";

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

          return (
            <div key={categoryId} className="single-booking-select-wrap passenger-select-wrap">
              <BsPeople className="single-booking-input-icon" />
              <Form.Select
                value={quantity}
                disabled={disabled}
                onChange={(event) => onChangeQuantity?.(categoryId, Number(event.target.value || 0))}
                aria-label={`Select ${category.label} quantity`}
              >
                {Array.from({ length: max - min + 1 }).map((_, index) => {
                  const count = min + index;
                  return (
                    <option key={`${categoryId}-${count}`} value={count}>
                      {category.label} x {count}
                    </option>
                  );
                })}
              </Form.Select>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PassengerCategorySelector;
