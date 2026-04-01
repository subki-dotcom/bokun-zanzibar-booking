import Badge from "react-bootstrap/Badge";

const ProductBadgeList = ({ badges = [], className = "" }) => {
  const validBadges = badges.map((item) => String(item || "").trim()).filter(Boolean);

  if (!validBadges.length) {
    return null;
  }

  return (
    <div className={`single-tour-badge-list ${className}`.trim()}>
      {validBadges.map((badge) => (
        <Badge className="single-tour-chip" key={badge}>
          {badge}
        </Badge>
      ))}
    </div>
  );
};

export default ProductBadgeList;
