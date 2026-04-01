import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import { FaClock, FaMapMarkerAlt } from "react-icons/fa";
import { Link } from "react-router-dom";
import { formatCurrency, toPlainText, truncateText } from "../../utils/formatters";

const TourCard = ({ tour }) => {
  const image = tour.images?.[0] || "https://images.unsplash.com/photo-1530521954074-e64f6810b32d";
  const plainSummary = truncateText(toPlainText(tour.shortDescription || tour.description || ""), 260);

  return (
    <Card className="surface-card h-100 overflow-hidden">
      <Card.Img src={image} alt={tour.title} style={{ height: 220, objectFit: "cover" }} />
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-2">
          <h5 className="mb-0 tour-card-title">{tour.title}</h5>
          <Badge bg="light" text="dark">
            {formatCurrency(tour.fromPrice, tour.currency)}
          </Badge>
        </div>
        <p className="section-subtitle mb-3 tour-card-summary">{plainSummary}</p>

        <div className="d-flex flex-column gap-1 text-muted small mb-3">
          <span>
            <FaClock className="me-2" />
            {tour.duration || "Flexible duration"}
          </span>
          <span>
            <FaMapMarkerAlt className="me-2" />
            {tour.destination || "Zanzibar"}
          </span>
        </div>

        <Button as={Link} to={`/tours/${tour.slug}`} className="premium-btn text-white w-100">
          View Experience
        </Button>
      </Card.Body>
    </Card>
  );
};

export default TourCard;
