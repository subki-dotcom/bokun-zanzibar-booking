import { useEffect, useState } from "react";
import { Col, Container, Row } from "react-bootstrap";
import { BsStarFill } from "react-icons/bs";
import { fetchPublicReviews } from "../../api/reviewsApi";

const TestimonialsSection = () => {
  const [reviewData, setReviewData] = useState({ reviews: [] });

  useEffect(() => {
    let mounted = true;
    fetchPublicReviews().then((data) => {
      if (mounted) setReviewData(data || { reviews: [] });
    }).catch(() => {
      if (mounted) setReviewData({ reviews: [] });
    });
    return () => { mounted = false; };
  }, []);

  const testimonials = reviewData.reviews || [];
  if (!testimonials.length) return null;

  return (
  <section className="z-home-section z-home-testimonials">
    <Container>
      <div className="z-home-section-head">
        <h2>Traveler testimonials</h2>
        <p>Recent traveler feedback from Google.</p>
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
              <strong>{item.name}</strong>{item.published ? <small>{item.published}</small> : null}
            </article>
          </Col>
        ))}
      </Row>
      {reviewData.reviewUrl ? <a className="z-home-reviews-link" href={reviewData.reviewUrl} target="_blank" rel="noreferrer">View all Google reviews</a> : null}
    </Container>
  </section>
  );
};

export default TestimonialsSection;
