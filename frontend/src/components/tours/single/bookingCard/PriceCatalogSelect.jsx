import Form from "react-bootstrap/Form";
import { BsChevronDown, BsTag } from "react-icons/bs";

const PriceCatalogSelect = ({
  options = [],
  value = "",
  disabled = false,
  onChange
}) => {
  if (!options.length) {
    return (
      <div className="single-booking-inline-muted">
        Using default Bokun price catalog
      </div>
    );
  }

  return (
    <div>
      <div className="single-booking-inline-label">Price catalog (Bokun)</div>
      <div className="single-booking-select-wrap">
        <BsTag className="single-booking-input-icon" />
        <Form.Select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.value)}
          aria-label="Select price catalog"
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
              {option.isDefault ? " (Default)" : ""}
            </option>
          ))}
        </Form.Select>
        <BsChevronDown className="single-booking-input-arrow" />
      </div>
    </div>
  );
};

export default PriceCatalogSelect;
