import { useMemo, useState } from "react";

const ProductDetailTabs = ({ hasIncluded = false, hasMeeting = false, hasImportantInfo = false, hasReviews = false }) => {
  const tabs = useMemo(
    () => [
      { id: "itinerary", label: "Itinerary", visible: true },
      { id: "included", label: "What's included", visible: hasIncluded },
      { id: "meeting-pickup", label: "Meeting & pickup", visible: hasMeeting },
      { id: "important-info", label: "Important info", visible: hasImportantInfo },
      { id: "reviews", label: "Reviews", visible: hasReviews }
    ].filter((tab) => tab.visible),
    [hasIncluded, hasImportantInfo, hasMeeting, hasReviews]
  );
  const [activeTab, setActiveTab] = useState(tabs[0]?.id || "itinerary");

  const scrollToSection = (id) => {
    setActiveTab(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!tabs.length) {
    return null;
  }

  return (
    <nav className="product-detail-tabs" aria-label="Product information">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={activeTab === tab.id ? "is-active" : ""}
          aria-current={activeTab === tab.id ? "page" : undefined}
          onClick={() => scrollToSection(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
};

export default ProductDetailTabs;
