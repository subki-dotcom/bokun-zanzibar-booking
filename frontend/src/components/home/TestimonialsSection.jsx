import { Col, Container, Row } from "react-bootstrap";
import { BsStarFill } from "react-icons/bs";

const testimonials = [
  {
    name: "Emma W.",
    text: "Professional team, smooth booking, and exactly the experience we expected in Zanzibar.",
    rating: 5
  },
  {
    name: "Daniel K.",
    text: "Our transfer and tour coordination was perfect. Great communication and on-time pickup.",
    rating: 5
  },
  {
    name: "Amina R.",
    text: "Fast checkout and trusted service. The option details and live times made booking easy.",
    rating: 5
  }
];

const TestimonialsSection = () => (
  <section className="z-home-section z-home-testimonials">
    <Container>
      <div className="z-home-section-head">
        <h2>Traveler testimonials</h2>
        <p>Real feedback from guests who booked Zanzibar experiences with us.</p>
      </div>

      <Row className="g-3">
        {testimonials.map((item) => (
          <Col key={item.name} lg={4}>
            <article className="z-home-testimonial-card">
              <div className="z-home-testimonial-stars">
                {Array.from({ length: item.rating }).map((_, index) => (
                  <BsStarFill key={`${item.name}-${index}`} />
                ))}
              </div>
              <p>{item.text}</p>
              <strong>{item.name}</strong>
            </article>
          </Col>
        ))}
      </Row>
    </Container>
  </section>
);

export default TestimonialsSection;
