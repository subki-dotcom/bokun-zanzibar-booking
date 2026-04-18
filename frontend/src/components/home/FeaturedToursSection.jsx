import { Button, Col, Container, Row } from "react-bootstrap";
import { Link } from "react-router-dom";
import { BsClock, BsGeoAlt, BsStarFill } from "react-icons/bs";
import { formatHomePrice } from "./home.helpers";

const FeaturedToursSection = ({ tours = [], loading = false }) => (
  <section className="z-home-section">
    <Container>
      <div className="z-home-section-head">
        <h2>Featured tours</h2>
        <p>Handpicked tours and excursions with live pricing and availability from Bokun.</p>
      </div>

      <Row className="g-3 g-lg-4">
        {(tours || []).map((tour) => {
          const detailPath = tour.slug ? `/tours/${tour.slug}` : "/tours";
          const hasRating = Number(tour.rating || 0) > 0;
          const hasReviews = Number(tour.reviewCount || 0) > 0;

          return (
            <Col key={tour.id || tour.slug || tour.title} lg={4} md={6}>
              <article className="z-home-tour-card">
                <div className="z-home-tour-image-wrap">
                  <img src={tour.image} alt={tour.title} className="z-home-tour-image" loading="lazy" />
                  <span className="z-home-tour-badge">Bokun powered</span>
                </div>

                <div className="z-home-tour-body">
                  <h4>{tour.title}</h4>
                  <p>{tour.shortDescription}</p>

                  <div className="z-home-tour-meta">
                    <span>
                      <BsClock />
                      {tour.duration}
                    </span>
                    <span>
                      <BsGeoAlt />
                      {tour.location}
                    </span>
                  </div>

                  {hasRating ? (
                    <div className="z-home-tour-rating">
                      <BsStarFill />
                      {Number(tour.rating).toFixed(1)}
                      {hasReviews ? <small>({Number(tour.reviewCount).toLocaleString()} reviews)</small> : null}
                    </div>
                  ) : null}

                  <div className="z-home-tour-footer">
                    <strong>{formatHomePrice(tour)}</strong>
                    <Button as={Link} to={detailPath} className="premium-btn text-white">
                      View details
                    </Button>
                  </div>
                </div>
              </article>
            </Col>
          );
        })}
      </Row>

      {!loading && tours.length === 0 ? (
        <div className="z-home-empty-note">Featured tours are updating. Please check again shortly.</div>
      ) : null}
    </Container>
  </section>
);

export default FeaturedToursSection;
