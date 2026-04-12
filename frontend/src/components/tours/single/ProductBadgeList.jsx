const ProductBadgeList = ({ badges = [], className = "" }) => {
  const validBadges = badges.map((item) => String(item || "").trim()).filter(Boolean);

  if (!validBadges.length) {
    return null;
  }

  return (
    <div className={`single-tour-badge-list ${className}`.trim()}>
      {validBadges.map((badge, index) => (
        <span className="single-tour-chip" key={`${badge}-${index}`}>
          {badge}
        </span>
      ))}
    </div>
  );
};

export default ProductBadgeList;
