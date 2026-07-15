import { Link } from "react-router-dom";
import { BsArrowLeft, BsStarFill } from "react-icons/bs";

const ProductTopRow = ({ rating = 0, reviewCount = 0 }) => {
  const hasRating = Number(rating) > 0;
  const hasReviews = Number(reviewCount) > 0;

  return (
    <div className="product-top-row">
      <Link to="/tours" className="product-back-link">
        <BsArrowLeft />
        Back to all tours
      </Link>

      {hasRating || hasReviews ? (
        <div className="product-rating-inline" aria-label={`${rating || 0} out of 5 from ${reviewCount || 0} reviews`}>
          <strong>{hasRating && Number(rating) >= 4.5 ? "Excellent" : "Guest rating"}</strong>
          {hasRating ? (
            <span className="product-rating-stars" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, index) => (
                <BsStarFill key={index} className={index < Math.round(Number(rating)) ? "is-filled" : ""} />
              ))}
            </span>
          ) : null}
          {hasRating ? <span>{Number(rating).toFixed(1)}</span> : null}
          {hasReviews ? <span>({Number(reviewCount)} reviews)</span> : null}
        </div>
      ) : null}
    </div>
  );
};

export default ProductTopRow;
