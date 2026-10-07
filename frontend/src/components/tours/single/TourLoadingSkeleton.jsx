import { Container } from "react-bootstrap";
import "./tourLoadingSkeleton.css";

export const SkeletonBlock = ({ className = "" }) => <div className={`tour-skeleton-block ${className}`} />;

export const OptionLoadingSkeleton = () => (
  <div className="tour-skeleton-card" aria-hidden="true">
    <SkeletonBlock className="tour-skeleton-heading" />
    <SkeletonBlock />
    <SkeletonBlock className="tour-skeleton-short" />
    <div className="tour-skeleton-fields"><SkeletonBlock /><SkeletonBlock /></div>
    <SkeletonBlock className="tour-skeleton-button" />
  </div>
);

const TourLoadingSkeleton = () => (
  <main className="single-tour-page product-detail-page" aria-busy="true" role="status" aria-label="Loading tour details">
    <Container className="product-detail-shell tour-skeleton-page">
      <span className="visually-hidden">Loading tour details...</span>
      <div aria-hidden="true">
        <SkeletonBlock className="tour-skeleton-breadcrumb" />
        <div className="tour-skeleton-layout">
          <div>
            <div className="tour-skeleton-gallery">
              <SkeletonBlock className="tour-skeleton-photo" />
              <div className="tour-skeleton-thumbnails"><SkeletonBlock /><SkeletonBlock /></div>
            </div>
            <SkeletonBlock className="tour-skeleton-title" />
            <SkeletonBlock className="tour-skeleton-short" />
            <div className="tour-skeleton-facts"><SkeletonBlock /><SkeletonBlock /><SkeletonBlock /></div>
            <div className="tour-skeleton-card"><SkeletonBlock className="tour-skeleton-heading" /><SkeletonBlock /><SkeletonBlock /><SkeletonBlock className="tour-skeleton-short" /></div>
          </div>
          <aside className="tour-skeleton-sidebar"><OptionLoadingSkeleton /><OptionLoadingSkeleton /></aside>
        </div>
      </div>
    </Container>
  </main>
);

export default TourLoadingSkeleton;
