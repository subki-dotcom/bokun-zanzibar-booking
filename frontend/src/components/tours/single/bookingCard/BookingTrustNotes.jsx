import { BsCheckCircle, BsShieldCheck } from "react-icons/bs";

const BookingTrustNotes = () => (
  <div className="single-booking-trust mt-3">
    <div>
      <BsShieldCheck className="me-2" />
      Live pricing and availability
    </div>
    <div>
      <BsCheckCircle className="me-2" />
      Departure time shown after date selection
    </div>
    <div>
      <BsCheckCircle className="me-2" />
      Final booking is confirmed in Bokun
    </div>
  </div>
);

export default BookingTrustNotes;
