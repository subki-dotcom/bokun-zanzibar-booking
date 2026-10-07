import "./skeleton.css";

export const SkeletonLine = ({ className = "" }) => <div className={`app-skeleton-line ${className}`} aria-hidden="true" />;

const Loader = ({ message = "Loading...", variant = "page", showMessage = false }) => (
  <div className={`app-skeleton app-skeleton-${variant}`} role="status" aria-busy="true" aria-label={message}>
    <span className={showMessage ? "app-skeleton-message" : "visually-hidden"}>{message}</span>
    <div aria-hidden="true">
      {variant !== "inline" && <SkeletonLine className="app-skeleton-title" />}
      {["page", "cards"].includes(variant) && <div className="app-skeleton-grid">
        {[1, 2, 3].map((item) => <div className="app-skeleton-card" key={item}>
          {variant === "cards" && <SkeletonLine className="app-skeleton-image" />}
          <SkeletonLine className="app-skeleton-heading" /><SkeletonLine /><SkeletonLine className="app-skeleton-short" />
        </div>)}
      </div>}
      {variant !== "cards" && <div className={variant === "form" ? "app-skeleton-form" : "app-skeleton-rows"}>
        {Array.from({ length: variant === "inline" ? 2 : variant === "form" ? 6 : 5 }, (_, index) =>
          <div key={index} className="app-skeleton-row"><SkeletonLine /><SkeletonLine className="app-skeleton-short" /></div>
        )}
      </div>}
    </div>
  </div>
);

export default Loader;
