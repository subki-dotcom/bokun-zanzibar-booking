import { Button, Col, Container, Row } from "react-bootstrap";
import { Link } from "react-router-dom";
import { BsArrowRight } from "react-icons/bs";

const TourCategoriesSection = ({ categories = [] }) => (
  <section className="z-home-section">
    <Container>
      <div className="z-home-section-head">
        <h2>Tour categories</h2>
        <p>Explore experiences by trip style and find what matches your Zanzibar plan.</p>
      </div>

      <Row className="g-3">
        {(categories || []).map((category) => (
          <Col key={category.name} lg={2} md={4} sm={6}>
            <article className="z-home-category-card">
              <h6>{category.name}</h6>
              <span>{Number(category.count || 0) > 0 ? `${category.count} tours` : "Live availability"}</span>
              <Button
                as={Link}
                to={`/tours?category=${encodeURIComponent(category.name)}&page=1`}
                variant="outline-secondary"
                size="sm"
              >
                Explore
                <BsArrowRight className="ms-1" />
              </Button>
            </article>
          </Col>
        ))}
      </Row>
    </Container>
  </section>
);

export default TourCategoriesSection;
