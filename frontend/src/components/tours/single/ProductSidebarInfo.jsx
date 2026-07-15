import { BsCarFront, BsCheckCircleFill, BsGeoAlt, BsShieldCheck, BsStarFill, BsXCircleFill } from "react-icons/bs";
import { toTextList } from "./singleTour.helpers";

const SidebarCard = ({ title, children, className = "" }) => (
  <section className={`product-sidebar-card ${className}`.trim()}>
    <h3>{title}</h3>
    {children}
  </section>
);

const CompactList = ({ items = [], tone = "success" }) => (
  <ul className={`product-sidebar-list is-${tone}`}>
    {items.map((item, index) => (
      <li key={`${item}-${index}`}>
        {tone === "danger" ? <BsXCircleFill /> : <BsCheckCircleFill />}
        <span>{item}</span>
      </li>
    ))}
  </ul>
);

const ProductSidebarInfo = ({ tour = {} }) => {
  const included = toTextList(tour.included);
  const excluded = toTextList(tour.excluded);
  const importantInformation = toTextList(tour.importantInformation);
  const hasMeeting = Boolean(tour.meetingInfo || tour.pickupInfo);
  const hasRating = Number(tour.rating) > 0 || Number(tour.reviewCount) > 0;
  const supportsCancellation = /free cancellation|full refund|cancel.{0,40}advance/i.test(tour.cancellationPolicy || "");

  return (
    <div className="product-sidebar-info-stack">
      <SidebarCard title="Why book with us?" className="product-benefits-card">
        {supportsCancellation ? (
          <div className="product-benefit-row"><BsCheckCircleFill /><span><strong>Free cancellation</strong>{tour.cancellationPolicy}</span></div>
        ) : null}
        <div className="product-benefit-row"><BsShieldCheck /><span><strong>Secure payments</strong>Your payment information is protected.</span></div>
        <div className="product-benefit-row"><BsCheckCircleFill /><span><strong>Live availability</strong>Availability is checked with the supplier.</span></div>
      </SidebarCard>

      {hasRating ? (
        <SidebarCard title="Guest rating" className="product-rating-card">
          <div className="product-sidebar-rating">
            <span className="product-rating-stars" aria-hidden="true">{Array.from({ length: 5 }).map((_, index) => <BsStarFill className={index < Math.round(Number(tour.rating || 0)) ? "is-filled" : ""} key={index} />)}</span>
            {Number(tour.rating) > 0 ? <strong>{Number(tour.rating).toFixed(1)}</strong> : null}
            {Number(tour.reviewCount) > 0 ? <span>({Number(tour.reviewCount)} reviews)</span> : null}
          </div>
        </SidebarCard>
      ) : null}

      <SidebarCard title="We accept" className="product-payment-card">
        <div className="product-payment-logos">
          <img src="/assets/payment-logos/pesapal.svg" alt="Pesapal" loading="lazy" />
          <img src="/assets/payment-logos/dpo.svg" alt="DPO Pay" loading="lazy" />
          <img src="/assets/payment-logos/paypal.svg" alt="PayPal" loading="lazy" />
        </div>
      </SidebarCard>

      {included.length || excluded.length ? (
        <SidebarCard title="Included">
          {included.length ? <CompactList items={included} /> : null}
          {excluded.length ? <><h4 className="product-sidebar-subtitle">Not included</h4><CompactList items={excluded} tone="danger" /></> : null}
        </SidebarCard>
      ) : null}

      {hasMeeting ? (
        <SidebarCard title="Meeting and pickup">
          {tour.meetingInfo ? <div className="product-sidebar-detail"><BsGeoAlt /><span><small>Meeting point</small>{tour.meetingInfo}</span></div> : null}
          {tour.pickupInfo ? <div className="product-sidebar-detail"><BsCarFront /><span><small>Pickup</small>{tour.pickupInfo}</span></div> : null}
        </SidebarCard>
      ) : null}

      {importantInformation.length ? <SidebarCard title="Important information"><CompactList items={importantInformation} /></SidebarCard> : null}
    </div>
  );
};

export default ProductSidebarInfo;
