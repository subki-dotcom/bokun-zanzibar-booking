import { Badge, Card, Button } from "react-bootstrap";
import { Link } from "react-router-dom";
import { BsClock, BsGeoAlt } from "react-icons/bs";
import TourMetaRow from "./TourMetaRow";
import TourPriceDisplay from "./TourPriceDisplay";

const TourCard = ({ tour = {} }) => (
  <Card className="listing-tour-card h-100">
    <div className="listing-tour-image-wrap">
      <Card.Img src={tour.image} alt={tour.title} className="listing-tour-image" />
      {tour.badge ? <Badge className="listing-tour-badge">{tour.badge}</Badge> : null}
    </div>

    <Card.Body className="listing-tour-body">
      <h3 className="listing-tour-title">{tour.title}</h3>
      <p className="listing-tour-description">{tour.shortDescription || "Check live product details from Bokun."}</p>

      <div className="listing-tour-meta">
        <TourMetaRow icon={<BsClock />} label={tour.durationText || "Flexible duration"} />
        <TourMetaRow icon={<BsGeoAlt />} label={tour.locationText || "Zanzibar"} />
      </div>

      <TourPriceDisplay
        fromPrice={tour.fromPrice}
        currency={tour.currency}
        pricingType={tour.pricingType}
      />

      <Button as={Link} to={`/tours/${tour.slug}`} className="listing-tour-cta text-white w-100">
        View Experience
      </Button>
    </Card.Body>
  </Card>
);

export default TourCard;
