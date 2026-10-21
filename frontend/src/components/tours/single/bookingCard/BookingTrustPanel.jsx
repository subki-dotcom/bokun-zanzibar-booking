import { BsCalendarCheck, BsEnvelope, BsShieldLock, BsTelephone, BsWhatsapp } from "react-icons/bs";
import { BRAND } from "../../../../config/brand";
import { freeCancellationLabel, tourQuestionWhatsappHref } from "./bookingTrust";

const PAYMENT_LOGOS = [
  { src: "/assets/payment-logos/pesapal.svg", alt: "Pesapal" },
  { src: "/assets/payment-logos/dpo.svg", alt: "DPO" },
  { src: "/assets/payment-logos/paypal.svg", alt: "PayPal" }
];

// Reassurance next to the booking button, from the tour's real cancellation policy and the real contact details.
const BookingTrustPanel = ({ tourTitle = "", cancellationSummary = "" }) => {
  const freeCancellation = freeCancellationLabel(cancellationSummary);
  const whatsappHref = tourQuestionWhatsappHref(BRAND.whatsappHref, tourTitle);

  return (
    <div className="booking-trust-panel">
      <ul className="booking-trust-list">
        {freeCancellation ? (
          <li><BsCalendarCheck aria-hidden="true" /> {freeCancellation}</li>
        ) : null}
        <li><BsEnvelope aria-hidden="true" /> Booking confirmation by email after payment</li>
        <li>
          <BsShieldLock aria-hidden="true" /> Secure payment
          <span className="booking-trust-logos">
            {PAYMENT_LOGOS.map((logo) => <img key={logo.alt} src={logo.src} alt={logo.alt} width="54" height="17" />)}
          </span>
        </li>
      </ul>
      <div className="booking-trust-contact">
        {whatsappHref ? (
          <a className="booking-trust-whatsapp" href={whatsappHref} target="_blank" rel="noopener noreferrer">
            <BsWhatsapp aria-hidden="true" /> Ask a question about this tour
          </a>
        ) : null}
        <span>
          <a href={BRAND.phoneHref}><BsTelephone aria-hidden="true" /> {BRAND.phone}</a>
          {" · "}
          <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>
        </span>
      </div>
    </div>
  );
};

export default BookingTrustPanel;
