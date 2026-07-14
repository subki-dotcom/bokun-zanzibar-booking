import { Container, Row, Col } from "react-bootstrap";
import { BsGeoAlt, BsShieldCheck, BsClock, BsSignpostSplit, BsCarFront, BsWater } from "react-icons/bs";
import { toPlainText, truncateText } from "../../utils/formatters";

const fallbackImage = "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=1400&q=80";

const resolveTourImage = (tour = {}) => {
  const first = Array.isArray(tour.images) ? tour.images[0] : "";
  if (typeof first === "string") return first || fallbackImage;
  return first?.url || first?.thumbnailUrl || first?.src || fallbackImage;
};

const CheckoutTopBar = ({ stepper = null }) => (
  <div className="checkout-topbar">
    <div className="checkout-brand">
      <span className="checkout-brand-mark">R</span>
      <span>
        <strong>Riser</strong>
        <small>Tours & Safaris</small>
      </span>
    </div>
    <div className="checkout-topbar-steps">{stepper}</div>
    <div className="checkout-secure-chip">
      <BsShieldCheck />
      <span>
        <strong>Secure Booking</strong>
        <small>Your data is protected</small>
      </span>
    </div>
  </div>
);

const CheckoutHero = ({ tour = null }) => {
  if (!tour) return null;

  const image = resolveTourImage(tour);
  const summary = truncateText(toPlainText(tour.shortDescription || tour.description || ""), 145);

  return (
    <div className="checkout-tour-hero">
      <div className="checkout-tour-image-wrap">
        <img src={image} alt={tour.title || "Tour"} className="checkout-tour-image" />
        <span className="checkout-tour-badge">{tour.categories?.[0] || "Zanzibar Tour"}</span>
      </div>
      <div className="checkout-tour-copy">
        <div className="checkout-tour-location">
          <BsGeoAlt />
          <span>{tour.destination || "Zanzibar"}</span>
        </div>
        <h1>{tour.title || "Booking Checkout"}</h1>
        {summary ? <p>{summary}</p> : null}
        <div className="checkout-tour-tags">
          <span><BsClock /> Half Day</span>
          <span><BsWater /> Snorkeling</span>
          <span><BsSignpostSplit /> Boat Trip</span>
          <span><BsCarFront /> Shared Tour</span>
        </div>
      </div>
    </div>
  );
};

const BookingFlowLayout = ({
  title = "",
  subtitle = "",
  stepper = null,
  left = null,
  right = null,
  tour = null
}) => (
  <section className="smart-checkout-page">
    <Container className="checkout-shell">
      <CheckoutTopBar stepper={stepper} />
      {!tour ? (
        <div className="smart-checkout-head mb-3 mb-lg-4">
          <div className="single-booking-eyebrow">Secure checkout</div>
          <h2>{title}</h2>
          {subtitle ? <p className="mb-0">{subtitle}</p> : null}
        </div>
      ) : null}

      <Row className="g-4 booking-flow-grid">
        <Col lg={8} className="booking-flow-main">
          <CheckoutHero tour={tour} />
          {left}
        </Col>
        <Col lg={4} className="booking-flow-side">
          {right}
        </Col>
      </Row>
    </Container>
  </section>
);

export default BookingFlowLayout;
