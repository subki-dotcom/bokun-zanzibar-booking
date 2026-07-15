import { useEffect, useMemo, useState } from "react";
import { Container } from "react-bootstrap";
import { useSearchParams } from "react-router-dom";
import { fetchTourCategories, fetchTours, searchToursByAvailability } from "../../../api/toursApi";
import Loader from "../../common/Loader";
import ErrorAlert from "../../common/ErrorAlert";
import ListingHeader from "./ListingHeader";
import FilterSortBar from "./FilterSortBar";
import TourGrid from "./TourGrid";
import ListingPagination from "./ListingPagination";
import SeoHead from "../../common/SeoHead";
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
      travelDate: String(searchParams.get("travelDate") || ""),
      travelers: readPositiveInt(searchParams.get("travelers"), 2),
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
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityBySlug, setAvailabilityBySlug] = useState({});
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
    let mounted = true;
    const slugs = (rawTours || []).map((tour) => String(tour.slug || "").trim()).filter(Boolean);

    if (!filters.travelDate || !slugs.length) {
      setAvailabilityBySlug({});
      setAvailabilityLoading(false);
      return () => { mounted = false; };
    }

    const loadLiveAvailability = async () => {
      setAvailabilityLoading(true);
      try {
        const rows = await searchToursByAvailability({
          travelDate: filters.travelDate,
          pax: { adults: filters.travelers, children: 0, infants: 0 },
          slugs
        });
        if (mounted) {
          setAvailabilityBySlug(
            (rows || []).reduce((map, row) => ({ ...map, [row.slug]: row }), {})
          );
        }
      } catch (err) {
        if (mounted) {
          setError(err.message || "Live availability could not be checked. Please try again.");
          setAvailabilityBySlug({});
        }
      } finally {
        if (mounted) setAvailabilityLoading(false);
      }
    };

    loadLiveAvailability();
    return () => { mounted = false; };
  }, [filters.travelDate, filters.travelers, rawTours]);

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

  const availabilityFilteredTours = useMemo(() => {
    if (!filters.travelDate || availabilityLoading) {
      return filteredTours;
    }
    return filteredTours.filter((tour) => availabilityBySlug[tour.slug]?.available);
  }, [availabilityBySlug, availabilityLoading, filteredTours, filters.travelDate]);

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
      <SeoHead title="Zanzibar Tours & Activities | Riser Tours & Safaris" description="Compare Zanzibar tours and check live availability by date before booking." />
      <Container>
        <ListingHeader
          totalItems={pagination.totalItems || 0}
          filteredCount={availabilityFilteredTours.length}
        />

        <FilterSortBar
          query={filters.query}
          category={filters.category}
          duration={filters.duration}
          travelDate={filters.travelDate}
          travelers={filters.travelers}
          sort={filters.sort}
          categoryOptions={categoryOptions}
          resultCount={availabilityFilteredTours.length}
          onFilterChange={handleFilterChange}
        />

        <ErrorAlert error={error} className="mb-3" />
        {loading ? <Loader message="Loading Zanzibar experiences..." /> : availabilityLoading ? <Loader message="Checking live availability..." /> : <TourGrid tours={availabilityFilteredTours} />}

        {!loading ? (
          <ListingPagination pagination={pagination} onPageChange={handlePageChange} />
        ) : null}
      </Container>
    </section>
  );
};

export default ToursListingPage;
