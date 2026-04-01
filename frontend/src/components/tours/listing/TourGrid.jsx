import { Col, Row } from "react-bootstrap";
import TourCard from "./TourCard";

const TourGrid = ({ tours = [] }) => {
  if (!tours.length) {
    return (
      <div className="listing-empty-state">
        <h4>No tours match your filters</h4>
        <p>Try another search, category, or duration to find more Zanzibar experiences.</p>
      </div>
    );
  }

  return (
    <Row className="g-4">
      {tours.map((tour) => (
        <Col key={tour.id || tour.slug} xs={12} md={6} xl={4}>
          <TourCard tour={tour} />
        </Col>
      ))}
    </Row>
  );
};

export default TourGrid;
