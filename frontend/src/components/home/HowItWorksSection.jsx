import { Col, Container, Row } from "react-bootstrap";

const steps = [
  {
    id: "01",
    title: "Choose your tour",
    copy: "Browse tours, compare options, and pick the experience that fits your plan."
  },
  {
    id: "02",
    title: "Check availability",
    copy: "Select date and travelers to fetch live slots and prices from Bokun."
  },
  {
    id: "03",
    title: "Confirm booking",
    copy: "Complete checkout securely and receive your booking confirmation fast."
  }
];

const HowItWorksSection = () => (
  <section className="z-home-section">
    <Container>
      <div className="z-home-section-head">
        <h2>How it works</h2>
        <p>Simple booking steps built for speed and confidence.</p>
      </div>

      <Row className="g-3">
        {steps.map((step) => (
          <Col key={step.id} lg={4}>
            <article className="z-home-step-card">
              <span>{step.id}</span>
              <h5>{step.title}</h5>
              <p>{step.copy}</p>
            </article>
          </Col>
        ))}
      </Row>
    </Container>
  </section>
);

export default HowItWorksSection;
