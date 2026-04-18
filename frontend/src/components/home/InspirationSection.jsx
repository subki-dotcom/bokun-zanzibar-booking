import { Button, Col, Container, Row } from "react-bootstrap";
import { Link } from "react-router-dom";

const InspirationSection = () => (
  <section className="z-home-section">
    <Container>
      <article className="z-home-inspiration">
        <Row className="g-4 align-items-center">
          <Col lg={6}>
            <div className="z-home-inspiration-copy">
              <h3>Experience Zanzibar beyond the ordinary</h3>
              <p>
                Sail across turquoise waters, explore Stone Town heritage, discover forest wildlife, and connect with
                authentic island culture through premium curated tours.
              </p>
              <div className="d-flex flex-wrap gap-2">
                <Button as={Link} to="/tours" className="premium-btn text-white">
                  Explore all experiences
                </Button>
                <Button as={Link} to="/tours?q=Private" variant="outline-secondary">
                  Private experiences
                </Button>
              </div>
            </div>
          </Col>

          <Col lg={6}>
            <div className="z-home-inspiration-images">
              <img
                src="https://images.unsplash.com/photo-1519058082700-08a0b56da9b4?auto=format&fit=crop&w=1200&q=80"
                alt="Zanzibar beach inspiration"
                loading="lazy"
              />
            </div>
          </Col>
        </Row>
      </article>
    </Container>
  </section>
);

export default InspirationSection;
