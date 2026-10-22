import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LuArrowLeft, LuMapPin, LuShare2, LuStar, LuStarHalf } from "react-icons/lu";
import { BRAND } from "../../../config/brand";
import { hasRealReviews, shortTourName, starStates, tourCategoryLabel, tourLocationLabel } from "./tourPageData";

// Share the page with the device's share sheet, or copy the link.
export const useShareTour = (title = "") => {
  const [message, setMessage] = useState("");
  const share = async () => {
    const url = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMessage("Link copied");
    } catch {
      return;
    }
    setTimeout(() => setMessage(""), 2200);
  };
  return { share, message };
};

export const Stars = ({ rating = 0 }) => (
  <span className="tp-stars" aria-hidden="true">
    {starStates(rating).map((state, index) =>
      state === "half" ? <LuStarHalf key={index} fill="currentColor" /> : <LuStar key={index} className={state === "empty" ? "is-empty" : ""} fill="currentColor" />
    )}
  </span>
);

export const Breadcrumb = ({ tour = {} }) => (
  <nav className="tp-breadcrumb" aria-label="Breadcrumb">
    <ol>
      <li><Link to="/">Home</Link></li>
      <li><Link to="/tours">{String(tour.destination || "Zanzibar")}</Link></li>
      <li><Link to="/tours">{tourCategoryLabel(tour)}</Link></li>
      <li aria-current="page">{shortTourName(tour.title)}</li>
    </ol>
  </nav>
);

// Title, real rating (only with reviews), location and the "Likely to sell out" badge when availability is low.
export const TourTitle = ({ tour = {}, lowAvailability = false, onShare, showActions = true }) => {
  const reviews = hasRealReviews(tour);
  return (
    <div className="tp-title-row">
      <div>
        <h1>{tour.title}</h1>
        <div className="tp-meta">
          {reviews ? (
            <span className="tp-meta-item">
              <Stars rating={tour.rating} />
              <strong>{Number(tour.rating).toFixed(1)}</strong>
              <a className="tp-rating-link" href="#reviews">{Number(tour.reviewCount)} reviews</a>
            </span>
          ) : null}
          <span className="tp-meta-item"><LuMapPin aria-hidden="true" /> {tourLocationLabel(tour)}</span>
          {lowAvailability ? <span className="tp-urgency">Likely to sell out</span> : null}
        </div>
      </div>
      {showActions ? (
        <div className="tp-title-actions">
          <button type="button" className="tp-pill-btn" onClick={onShare}>
            <LuShare2 aria-hidden="true" /> Share
          </button>
        </div>
      ) : null}
    </div>
  );
};

// Mobile header: back, brand, share.
export const MobileTourHeader = ({ onShare }) => {
  const navigate = useNavigate();
  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) navigate(-1);
    else navigate("/tours");
  };
  return (
    <header className="tp-mheader">
      <button type="button" className="tp-icon-btn" onClick={back} aria-label="Back">
        <LuArrowLeft aria-hidden="true" />
      </button>
      <strong>{BRAND.name}</strong>
      <button type="button" className="tp-icon-btn" onClick={onShare} aria-label="Share this tour">
        <LuShare2 aria-hidden="true" />
      </button>
    </header>
  );
};
