import { useMemo, useState } from "react";
import { Badge, Button, Card } from "react-bootstrap";
import { Link } from "react-router-dom";
import { BsClock, BsGeoAlt, BsStar, BsStarFill } from "react-icons/bs";
import TourMetaRow from "./TourMetaRow";
import {
  formatListingDuration,
  formatListingPrice,
  resolveSafeText
} from "./listing.helpers";

const FALLBACK_CARD_IMAGE =
  "https://images.unsplash.com/photo-1518544866330-95a67b1b5f39?auto=format&fit=crop&w=1200&q=80";

const TourCard = ({ tour = {} }) => {
  const safeTitle = resolveSafeText(tour.title, "Untitled experience");
  const safeDuration = formatListingDuration(tour.durationText);
  const safeLocation = resolveSafeText(tour.locationText, "Zanzibar");
  const safeDescription = resolveSafeText(
    tour.shortDescription,
    "Discover this Zanzibar experience with details on the next page."
  );
  const hasRating = Number(tour.rating || 0) > 0;
  const hasReviewCount = Number(tour.reviewCount || 0) > 0;
  const detailPath = resolveSafeText(tour.slug) ? `/tours/${tour.slug}` : "/tours";
  const [imageSrc, setImageSrc] = useState(resolveSafeText(tour.image, FALLBACK_CARD_IMAGE));

  const price = useMemo(
    () =>
      formatListingPrice({
        fromPrice: tour.fromPrice,
        currency: tour.currency,
        pricingType: tour.pricingType
      }),
    [tour.fromPrice, tour.currency, tour.pricingType]
  );

  return (
    <Card className="listing-tour-card h-100">
      <div className="listing-tour-image-wrap">
        <Card.Img
          src={imageSrc}
          alt={safeTitle}
          className="listing-tour-image"
          onError={() => {
            if (imageSrc !== FALLBACK_CARD_IMAGE) {
              setImageSrc(FALLBACK_CARD_IMAGE);
            }
          }}
        />
        {tour.badge ? <Badge className="listing-tour-badge">{tour.badge}</Badge> : null}
      </div>

      <Card.Body className="listing-tour-body">
        <h3 className="listing-tour-title">{safeTitle}</h3>
        <p className="listing-tour-description">{safeDescription}</p>

        <div className="listing-tour-meta">
          <TourMetaRow icon={<BsClock />} label={safeDuration} />
          <TourMetaRow icon={<BsGeoAlt />} label={safeLocation} />
        </div>

        <div className="listing-tour-signal-row" aria-label="Tour rating">
          <span className="listing-tour-signal-label">Rating</span>
          {hasRating ? (
            <div className="listing-tour-rating">
              <BsStarFill />
              <span className="listing-tour-rating-value">{Number(tour.rating).toFixed(1)}</span>
              {hasReviewCount ? (
                <span className="listing-tour-rating-count">
                  ({Number(tour.reviewCount).toLocaleString()} reviews)
                </span>
              ) : null}
            </div>
          ) : (
            <div className="listing-tour-rating is-empty">
              <BsStar />
              <span className="listing-tour-rating-count">Not rated yet</span>
            </div>
          )}
        </div>

        <div className="listing-tour-price-row" aria-label="Tour price">
          <span className="listing-tour-price-label">Starting price</span>
          <div className="listing-tour-price-value-wrap">
            <span className="listing-tour-price-main">
              {price.hasPrice ? price.heading : "Price on request"}
            </span>
            {price.hasPrice && price.subtext ? (
              <span className="listing-tour-price-note">{price.subtext}</span>
            ) : null}
          </div>
        </div>

        <Button as={Link} to={detailPath} className="listing-tour-cta text-white w-100">
          View Details
        </Button>
      </Card.Body>
    </Card>
  );
};

export default TourCard;
