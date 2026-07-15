import { useEffect, useMemo, useState } from "react";
import { Col, Row } from "react-bootstrap";
import { fetchTours } from "../../../api/toursApi";
import { mapBokunTourForListing } from "../listing/listing.helpers";
import TourCard from "../listing/TourCard";

const RelatedToursSection = ({ tour = {} }) => {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let mounted = true;
    fetchTours({ page: 1, limit: 18 })
      .then((result) => {
        if (mounted) setRows(result.items || []);
      })
      .catch(() => {
        if (mounted) setRows([]);
      });
    return () => { mounted = false; };
  }, []);

  const relatedTours = useMemo(() => {
    const categorySet = new Set((tour.categories || []).map((item) => String(item || "").toLowerCase()));
    return (rows || [])
      .filter((row) => String(row.slug || "") !== String(tour.slug || ""))
      .map(mapBokunTourForListing)
      .sort((left, right) => {
        const leftMatch = (left.categories || []).some((item) => categorySet.has(String(item || "").toLowerCase())) ? 1 : 0;
        const rightMatch = (right.categories || []).some((item) => categorySet.has(String(item || "").toLowerCase())) ? 1 : 0;
        return rightMatch - leftMatch;
      })
      .slice(0, 3);
  }, [rows, tour.categories, tour.slug]);

  if (!relatedTours.length) return null;

  return (
    <section className="related-tours-section" aria-labelledby="related-tours-title">
      <div className="related-tours-heading">
        <h3 id="related-tours-title">You may also like</h3>
        <p>Make more of your Zanzibar trip with another bookable experience.</p>
      </div>
      <Row className="g-3">
        {relatedTours.map((relatedTour) => (
          <Col key={relatedTour.id || relatedTour.slug} xs={12} md={6} xl={4}>
            <TourCard tour={relatedTour} />
          </Col>
        ))}
      </Row>
    </section>
  );
};

export default RelatedToursSection;
