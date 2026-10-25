import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchToursPage, searchToursByAvailability } from "../../../api/toursApi";
import { PAGE_SIZE, apiQuery, readFilters, resultsKey, writeFilters } from "./toursPageData";

// The filters, read from and written to the address. Changing a filter goes back to the first page.
export const useTourFilters = () => {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const update = useCallback(
    (patch, { replace = false, keepPage = false } = {}) => {
      const next = { ...filters, ...patch };
      if (!keepPage && !("page" in patch)) next.page = 1;
      setParams(writeFilters(next), { replace });
    },
    [filters, setParams]
  );
  const clear = useCallback(
    () => update({ duration: [], time: [], good: [], priceMin: 0, priceMax: 0 }),
    [update]
  );
  return { filters, update, clear };
};

// Results for the filters: the pages up to ?page=N at first, then "Show more" adds the next page. With a date, only
// tours available that day (checked live, twelve at a time) are kept.
export const useToursResults = (filters, update) => {
  const [state, setState] = useState({ items: [], total: 0, facets: null, pages: 1, loading: true, error: "" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [availability, setAvailability] = useState({});
  const [checking, setChecking] = useState(false);
  const loadedPages = useRef(1);
  const key = resultsKey(filters);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: "" }));
    loadedPages.current = filters.page;
    fetchToursPage(apiQuery(filters, { page: 1, limit: PAGE_SIZE * filters.page }))
      .then((data) => {
        if (!active) return;
        setState({ items: data.items, total: data.total, facets: data.facets, pages: Math.max(1, Math.ceil(data.total / PAGE_SIZE)), loading: false, error: "" });
      })
      .catch((error) => active && setState((current) => ({ ...current, loading: false, error: error.message || "Tours could not be loaded." })));
    return () => {
      active = false;
    };
    // Only a filter change (not "Show more") starts again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loadMore = useCallback(async () => {
    const next = loadedPages.current + 1;
    setLoadingMore(true);
    try {
      const data = await fetchToursPage(apiQuery(filters, { page: next, limit: PAGE_SIZE }));
      loadedPages.current = next;
      setState((current) => ({ ...current, items: [...current.items, ...data.items.filter((item) => !current.items.some((row) => row.id === item.id))] }));
      update({ page: next }, { replace: true });
    } catch (error) {
      setState((current) => ({ ...current, error: error.message || "More tours could not be loaded." }));
    } finally {
      setLoadingMore(false);
    }
  }, [filters, update]);

  // Live availability for the chosen date (only for tours not checked yet).
  useEffect(() => {
    if (!filters.date || !state.items.length) return undefined;
    const slugs = state.items.map((item) => item.slug).filter((slug) => !(`${filters.date}|${filters.pax}|${slug}` in availability));
    if (!slugs.length) {
      setChecking(false);
      return undefined;
    }
    let active = true;
    setChecking(true);
    (async () => {
      const found = {};
      for (let index = 0; index < slugs.length; index += 12) {
        const batch = slugs.slice(index, index + 12);
        try {
          const rows = await searchToursByAvailability({ travelDate: filters.date, pax: { adults: filters.pax, children: 0, infants: 0 }, slugs: batch });
          batch.forEach((slug) => {
            found[`${filters.date}|${filters.pax}|${slug}`] = Boolean(rows.find((row) => row.slug === slug)?.available);
          });
        } catch {
          // Unknown availability keeps the tour on the list.
          batch.forEach((slug) => {
            found[`${filters.date}|${filters.pax}|${slug}`] = true;
          });
        }
      }
      if (active) {
        setAvailability((current) => ({ ...current, ...found }));
        setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [filters.date, filters.pax, state.items, availability]);

  const items = filters.date ? state.items.filter((item) => availability[`${filters.date}|${filters.pax}|${item.slug}`] !== false) : state.items;
  return { ...state, items, loadedCount: state.items.length, loadMore, loadingMore, checking };
};
