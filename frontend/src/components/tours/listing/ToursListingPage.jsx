import { useEffect, useMemo, useState } from "react";
import { Container } from "react-bootstrap";
import { useSearchParams } from "react-router-dom";
import { fetchTourCategories, fetchTours } from "../../../api/toursApi";
import Loader from "../../common/Loader";
import ErrorAlert from "../../common/ErrorAlert";
import ListingHeader from "./ListingHeader";
import FilterSortBar from "./FilterSortBar";
import TourGrid from "./TourGrid";
import ListingPagination from "./ListingPagination";
import {
  applyListingFiltersAndSort,
  buildCategoryFilterOptions,
  mapBokunTourForListing
} from "./listing.helpers";

const ITEMS_PER_PAGE = 9;

const readPositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const readFilterValue = (value = "", fallback = "all") => {
  const token = String(value || "").trim();
  return token || fallback;
};

const ToursListingPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activePage = useMemo(() => readPositiveInt(searchParams.get("page"), 1), [searchParams]);

  const filters = useMemo(
    () => ({
      query: String(searchParams.get("q") || ""),
      category: readFilterValue(searchParams.get("category"), "all"),
      duration: readFilterValue(searchParams.get("duration"), "all"),
      sort: readFilterValue(searchParams.get("sort"), "recommended")
    }),
    [searchParams]
  );

  const [rawTours, setRawTours] = useState([]);
  const [bokunCategoryRows, setBokunCategoryRows] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: ITEMS_PER_PAGE,
    totalItems: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadTours = async () => {
      try {
        setLoading(true);
        setError("");
        const result = await fetchTours({
          page: activePage,
          limit: ITEMS_PER_PAGE
        });

        setRawTours(result.items || []);
        setPagination((prev) => ({
          ...prev,
          ...(result.pagination || {}),
          page: result.pagination?.page || activePage
        }));
      } catch (err) {
        setError(err.message || "Failed to load tours");
      } finally {
        setLoading(false);
      }
    };

    loadTours();
  }, [activePage]);

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const rows = await fetchTourCategories();
        setBokunCategoryRows(Array.isArray(rows) ? rows : []);
      } catch {
        setBokunCategoryRows([]);
      }
    };

    loadCategories();
  }, []);

  const tours = useMemo(() => (rawTours || []).map(mapBokunTourForListing), [rawTours]);

  const filteredTours = useMemo(
    () =>
      applyListingFiltersAndSort(tours, {
        query: filters.query,
        category: filters.category,
        duration: filters.duration,
        sort: filters.sort
      }),
    [tours, filters]
  );

  const categoryOptions = useMemo(() => {
    if (bokunCategoryRows.length > 0) {
      return bokunCategoryRows
        .map((row) => String(row?.name || "").trim())
        .filter(Boolean);
    }

    return buildCategoryFilterOptions(tours);
  }, [bokunCategoryRows, tours]);

  const updateSearchParams = (mutator) => {
    const next = new URLSearchParams(searchParams);
    mutator(next);
    setSearchParams(next, { replace: false });
  };

  const handleFilterChange = (key, value) => {
    updateSearchParams((next) => {
      const token = String(value || "").trim();
      const isDefault =
        !token ||
        (key === "category" && token === "all") ||
        (key === "duration" && token === "all") ||
        (key === "sort" && token === "recommended");

      if (isDefault) {
        next.delete(key);
      } else {
        next.set(key, token);
      }

      next.set("page", "1");
    });
  };

  const handlePageChange = (nextPage) => {
    const safePage = Math.max(1, Number(nextPage || 1));
    updateSearchParams((next) => {
      next.set("page", String(safePage));
    });
  };

  return (
    <section className="tours-listing-page py-4 py-lg-5">
      <Container>
        <ListingHeader
          totalItems={pagination.totalItems || 0}
          filteredCount={filteredTours.length}
        />

        <FilterSortBar
          query={filters.query}
          category={filters.category}
          duration={filters.duration}
          sort={filters.sort}
          categoryOptions={categoryOptions}
          resultCount={filteredTours.length}
          onFilterChange={handleFilterChange}
        />

        <ErrorAlert error={error} className="mb-3" />
        {loading ? <Loader message="Loading Zanzibar experiences..." /> : <TourGrid tours={filteredTours} />}

        {!loading ? (
          <ListingPagination pagination={pagination} onPageChange={handlePageChange} />
        ) : null}
      </Container>
    </section>
  );
};

export default ToursListingPage;
