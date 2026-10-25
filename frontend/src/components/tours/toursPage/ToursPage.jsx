import { useRef } from "react";
import SeoHead from "../../common/SeoHead";
import ErrorAlert from "../../common/ErrorAlert";
import { BRAND } from "../../../config/brand";
import { shortDate } from "../../homePage/homeData";
import { CategoryChips, ToursIntro, ToursToolbar } from "./ToursTop";
import TourCard, { SkeletonCards } from "./TourCard";
import { useToursResults, useTourFilters } from "./useTourFilters";
import "./toursPage.css";

// /tours (mockups "Tours", "ToursMobile", "ToursFiltersMobile").
const ToursPage = () => {
  const { filters, update } = useTourFilters();
  const results = useToursResults(filters, update);
  const top = useRef(null);
  const total = results.facets?.total || 0;
  const shown = results.items.length;

  const setCategory = (category) => {
    update({ category });
    top.current?.scrollIntoView({ block: "start" });
  };

  return (
    <div className="tl">
      <SeoHead title={`Zanzibar Tours & Activities | ${BRAND.name}`} description="Compare Zanzibar tours, safaris and transfers with live prices and availability, free cancellation on most tours and hotel pickup." />
      <ToursIntro total={total} />

      <div className="tl-toolbar" ref={top}>
        <div className="tl-container">
          <ToursToolbar filters={filters} update={update} />
          <CategoryChips facets={results.facets} active={filters.category} onChange={setCategory} />
        </div>
      </div>

      <div className="tl-container tl-main">
        <section className="tl-results" aria-labelledby="tl-results-title">
          <h2 id="tl-results-title" className="tl-visually-hidden">Results</h2>
          <p className="tl-count" aria-live="polite">
            {results.loading ? "Finding tours…" : (
              <>
                Showing <strong>{shown}</strong> of <strong>{results.total}</strong> tours
                {filters.date ? ` available on ${shortDate(filters.date)}${results.checking ? " (checking…)" : ""}` : ""}
              </>
            )}
          </p>
          <ErrorAlert error={results.error} />
          <div className="tl-grid">
            {results.loading ? <SkeletonCards /> : results.items.map((tour, index) => <TourCard key={tour.id} tour={tour} priority={index < 3} />)}
          </div>
          {!results.loading && results.loadedCount < results.total ? (
            <button type="button" className="tl-more" onClick={results.loadMore} disabled={results.loadingMore}>
              {results.loadingMore ? "Loading…" : "Show more tours"}
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
};

export default ToursPage;
