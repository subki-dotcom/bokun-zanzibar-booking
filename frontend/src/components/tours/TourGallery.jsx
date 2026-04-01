import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

const TourGallery = ({ images = [] }) => {
  const fallback = "https://images.unsplash.com/photo-1551884170-09fb70a3a2ed";
  const [primary, ...rest] = images.length ? images : [fallback];

  return (
    <div className="tour-gallery surface-card">
      <Row className="g-0">
        <Col md={8}>
          <img src={primary} alt="Tour visual" />
        </Col>
        <Col md={4}>
          <div className="h-100 d-flex flex-column">
            {rest.slice(0, 2).map((image, idx) => (
              <img
                key={image + idx}
                src={image}
                alt={`Tour visual ${idx + 2}`}
                style={{ height: "50%", objectFit: "cover" }}
              />
            ))}
            {rest.length === 0 ? (
              <img src={primary} alt="Tour visual alt" style={{ height: "100%", objectFit: "cover" }} />
            ) : null}
          </div>
        </Col>
      </Row>
    </div>
  );
};

export default TourGallery;