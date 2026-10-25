import { useRef } from "react";
import SeoHead from "../../common/SeoHead";
import ErrorAlert from "../../common/ErrorAlert";
import { BRAND } from "../../../config/brand";
import { shortDate } from "../../homePage/homeData";
import { CategoryChips, ToursIntro, ToursToolbar } from "./ToursTop";
import { FiltersSidebar } from "./ToursFilters";
import { EmptyState, LoadMore, SeoContent, SortPills } from "./ToursResults";
import TourCard, { SkeletonCards } from "./TourCard";
import { useToursResults, useTourFilters } from "./useTourFilters";
import { activeFilterCount } from "./toursPageData";
import "./toursPage.css";

// /tours (mockups "Tours", "ToursMobile", "ToursFiltersMobile").
const ToursPage = () => {
  const { filters, update, clear } = useTourFilters();
  const results = useToursResults(filters, update);
  const top = useRef(null);
  const total = results.facets?.total || 0;
  const shown = results.items.length;
  const activeCount = activeFilterCount(filters);

  const scrollToResults = () => top.current?.scrollIntoView({ block: "start" });
  const setCategory = (category) => {
    update({ category });
    scrollToResults();
  };
  const clearAll = () => {
    update({ category: "", q: "", duration: [], time: [], good: [], priceMin: 0, priceMax: 0, date: "" });
    scrollToResults();
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
        <FiltersSidebar filters={filters} facets={results.facets} update={update} clear={clear} activeCount={activeCount} />

        <section className="tl-results" aria-labelledby="tl-results-title">
          <h2 id="tl-results-title" className="tl-visually-hidden">Results</h2>
          <div className="tl-results-head">
            <p className="tl-count" aria-live="polite">
              {results.loading ? "Finding tours…" : (
                <>
                  Showing <strong>{shown}</strong> of <strong>{results.total}</strong> tours
                  {filters.date ? ` available on ${shortDate(filters.date)}${results.checking ? " (checking…)" : ""}` : ""}
                </>
              )}
            </p>
            <SortPills value={filters.sort} onChange={(sort) => update({ sort })} />
          </div>
          <ErrorAlert error={results.error} />
          {!results.loading && !results.error && !shown ? (
            <EmptyState onClear={clearAll} />
          ) : (
            <div className="tl-grid">
              {results.loading ? <SkeletonCards /> : results.items.map((tour, index) => <TourCard key={tour.id} tour={tour} priority={index < 3} />)}
            </div>
          )}
          {!results.loading && shown ? (
            <LoadMore
              filters={filters}
              shown={results.loadedCount}
              total={results.total}
              pages={results.pages}
              loadMore={results.loadMore}
              loading={results.loadingMore}
            />
          ) : null}
        </section>
      </div>

      <SeoContent />
    </div>
  );
};

export default ToursPage;
