import { Container, Row, Col } from "react-bootstrap";

const BookingFlowLayout = ({
  title = "",
  subtitle = "",
  stepper = null,
  left = null,
  right = null
}) => (
  <section className="smart-checkout-page py-4 py-lg-5">
    <Container>
      <div className="smart-checkout-head mb-3 mb-lg-4">
        <div className="single-booking-eyebrow">Secure checkout</div>
        <h2>{title}</h2>
        {subtitle ? <p className="mb-0">{subtitle}</p> : null}
      </div>

      {stepper}

      <Row className="g-4 booking-flow-grid">
        <Col lg={8} className="booking-flow-main">
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
