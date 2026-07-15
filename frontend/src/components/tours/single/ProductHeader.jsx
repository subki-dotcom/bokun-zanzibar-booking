import { useMemo, useState } from "react";
import { BsGeoAlt } from "react-icons/bs";
import ProductBadgeList from "./ProductBadgeList";
import { toPlainText } from "../../../utils/formatters";

const ProductHeader = ({ tour = {} }) => {
  const summary = toPlainText(tour.shortDescription || tour.description || "");
  const [expanded, setExpanded] = useState(false);
  const summaryPreview = summary.length > 220 && !expanded ? `${summary.slice(0, 220).trim()}...` : summary;
  const typeLabel = String(tour.experienceType || tour.categories?.[0] || "").trim();
  const badges = useMemo(
    () => Array.from(new Set([...(tour.categories || []), ...(tour.highlights || [])].map((item) => String(item || "").trim()).filter(Boolean))).slice(0, 7),
    [tour.categories, tour.highlights]
  );

  return (
    <section className="single-tour-header product-identity">
      {typeLabel ? <div className="single-tour-label"><BsGeoAlt /> {typeLabel}</div> : null}
      <h1 className="single-tour-title">{tour.title}</h1>
      {summary ? <div className="single-tour-summary-wrap"><p className="single-tour-summary">{summaryPreview}</p>{summary.length > 220 ? <button type="button" className="product-summary-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Read less" : "Read more"}</button> : null}</div> : null}
      <ProductBadgeList badges={badges} />
    </section>
  );
};

export default ProductHeader;
