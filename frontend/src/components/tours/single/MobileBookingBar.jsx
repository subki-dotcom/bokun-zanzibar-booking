import { BsCalendar3 } from "react-icons/bs";
import { formatCurrency } from "../../../utils/formatters";

const MobileBookingBar = ({ amount = 0, currency = "USD", onOpenBooking }) => (
  <div className="single-product-mobile-booking-bar">
    <div className="single-product-mobile-price">
      <strong>{Number(amount) > 0 ? formatCurrency(amount, currency) : "Live price"}</strong>
      <span>{Number(amount) > 0 ? "Starting price" : "Select a date"}</span>
    </div>
    <button type="button" className="single-product-mobile-book-button" onClick={onOpenBooking}>
      Check availability
    </button>
    <button type="button" className="single-product-mobile-calendar-button" onClick={onOpenBooking} aria-label="Open booking form">
      <BsCalendar3 />
    </button>
  </div>
);

export default MobileBookingBar;
