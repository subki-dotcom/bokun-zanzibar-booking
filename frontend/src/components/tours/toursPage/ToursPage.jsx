import { Fragment, useMemo, useRef, useState } from "react";
import SeoHead from "../../common/SeoHead";
import ErrorAlert from "../../common/ErrorAlert";
import { BRAND } from "../../../config/brand";
import { shortDate } from "../../homePage/homeData";
import { CategoryChips, ToursIntro, ToursToolbar } from "./ToursTop";
import { CustomTourBox, FiltersSidebar } from "./ToursFilters";
import { FiltersSheet, MobileFilterBar, SortSheet } from "./ToursMobile";
import { EmptyState, LoadMore, SeoContent, SortPills } from "./ToursResults";
import TourCard, { SkeletonCards } from "./TourCard";
import { useToursResults, useTourFilters } from "./useTourFilters";
import { activeFilterCount, itemListSchema, readPrerenderedTours } from "./toursPageData";
import "./toursPage.css";

export const TOURS_TITLE = `Zanzibar Tours & Activities | ${BRAND.name}`;
export const TOURS_DESCRIPTION =
  "Compare Zanzibar tours, safaris and transfers with live prices and availability: Mnemba snorkeling, Stone Town, spice farms and sunset cruises, with free cancellation on most tours and hotel pickup.";

// /tours (mockups "Tours", "ToursMobile", "ToursFiltersMobile"). initialData: the first page, from the build.
const ToursPage = ({ initialData = readPrerenderedTours() }) => {
  const { filters, update, clear } = useTourFilters();
  const results = useToursResults(filters, update, initialData);
  const schemas = useMemo(() => [itemListSchema(results.items.slice(0, 9), BRAND.website)], [results.items]);
  const top = useRef(null);
  const total = results.facets?.total || 0;
  const shown = results.items.length;
  const activeCount = activeFilterCount(filters);
  const [sheet, setSheet] = useState("");
  // Closing a sheet puts focus back on the button that opened it.
  const closeSheet = () => {
    const opener = sheet === "sort" ? ".tl-mbar-sort" : ".tl-mbar-filters";
    setSheet("");
    setTimeout(() => document.querySelector(opener)?.focus(), 0);
  };

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
      <SeoHead title={TOURS_TITLE} description={TOURS_DESCRIPTION} schemas={schemas} />
      <ToursIntro total={total} />

      <div className="tl-toolbar" ref={top}>
        <div className="tl-container">
          <ToursToolbar filters={filters} update={update} />
          <CategoryChips facets={results.facets} active={filters.category} onChange={setCategory} />
          <MobileFilterBar filters={filters} onFilters={() => setSheet("filters")} onSort={() => setSheet("sort")} onDate={(date) => update({ date })} />
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
              {results.loading ? (
                <SkeletonCards />
              ) : (
                results.items.map((tour, index) => (
                  <Fragment key={tour.id}>
                    <TourCard tour={tour} priority={index === 0 ? "high" : index < 3} />
                    {/* Phones: the custom-tour box after the second tour. */}
                    {index === 1 ? (
                      <div className="tl-grid-custom">
                        <CustomTourBox />
                      </div>
                    ) : null}
                  </Fragment>
                ))
              )}
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

      {sheet === "filters" ? (
        <FiltersSheet
          filters={filters}
          facets={results.facets}
          onClose={closeSheet}
          onApply={(draft) => {
            closeSheet();
            update({ ...draft, page: 1 });
            scrollToResults();
          }}
        />
      ) : null}
      {sheet === "sort" ? (
        <SortSheet
          value={filters.sort}
          onClose={closeSheet}
          onChange={(sort) => {
            closeSheet();
            update({ sort });
          }}
        />
      ) : null}
    </div>
  );
};

export default ToursPage;
