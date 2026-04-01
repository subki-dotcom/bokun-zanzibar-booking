import { useMemo, useRef } from "react";
import Form from "react-bootstrap/Form";
import { BsCalendar3 } from "react-icons/bs";

const formatLocalDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const DateAvailabilityPicker = ({ value = "", disabled = false, onChange }) => {
  const dateInputRef = useRef(null);
  const minDate = useMemo(() => formatLocalDate(new Date()), []);

  const openDatePicker = () => {
    if (!dateInputRef.current) {
      return;
    }

    if (typeof dateInputRef.current.showPicker === "function") {
      dateInputRef.current.showPicker();
      return;
    }

    dateInputRef.current.focus();
  };

  return (
    <div>
      <div className="single-booking-inline-label">Travel date</div>
      <div className="single-booking-select-wrap single-booking-date-wrap">
        <BsCalendar3 className="single-booking-input-icon" />
        <Form.Control
          ref={dateInputRef}
          type="date"
          min={minDate}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.value)}
          onFocus={openDatePicker}
          aria-label="Select date"
        />
        <button
          type="button"
          className="single-booking-date-btn"
          onClick={openDatePicker}
          aria-label="Open calendar"
        >
          <BsCalendar3 />
        </button>
      </div>
    </div>
  );
};

export default DateAvailabilityPicker;
