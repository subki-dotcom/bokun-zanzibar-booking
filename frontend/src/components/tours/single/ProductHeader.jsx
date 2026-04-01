import { BsClockHistory, BsGeoAlt, BsLightningCharge } from "react-icons/bs";
import PriceDisplay from "./PriceDisplay";
import ProductBadgeList from "./ProductBadgeList";
import { toPlainText } from "../../../utils/formatters";

const ProductHeader = ({ tour = {} }) => {
  const summary = toPlainText(tour.shortDescription || tour.description || "");
  const summaryPreview = summary.length > 260 ? `${summary.slice(0, 260).trim()}...` : summary;

  return (
    <section className="single-tour-header">
      <div className="single-tour-label">Bokun-powered experience</div>
      <h1 className="single-tour-title">{tour.title}</h1>
      <p className="single-tour-summary">{summaryPreview || "Product summary is managed in Bokun."}</p>

      <div className="single-tour-header-meta">
        <span>
          <BsClockHistory className="me-2" />
          {tour.duration || "Flexible duration"}
        </span>
        <span>
          <BsGeoAlt className="me-2" />
          {tour.destination || "Zanzibar"}
        </span>
        <span>
          <BsLightningCharge className="me-2" />
          Live pricing and availability
        </span>
      </div>

      <ProductBadgeList badges={tour.categories || []} />

      <div className="single-tour-inline-price">
        <PriceDisplay amount={tour.fromPrice} currency={tour.currency} compact />
      </div>
    </section>
  );
};

export default ProductHeader;
