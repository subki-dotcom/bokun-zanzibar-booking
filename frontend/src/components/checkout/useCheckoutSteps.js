import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { STEPS } from "./checkoutData";

const IDS = STEPS.map((step) => step.id);

// The open step lives in the URL hash (#contact, #activity, #payment), so browser Back moves between steps.
// A step opens only when every step before it is complete; otherwise the first incomplete step opens.
const useCheckoutSteps = (completed = {}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const requested = location.hash.replace(/^#/, "");
  const reachable = (id) => IDS.slice(0, IDS.indexOf(id)).every((previous) => completed[previous]);
  const firstOpen = IDS.find((id) => !completed[id]) || IDS[IDS.length - 1];
  const open = IDS.includes(requested) && reachable(requested) ? requested : firstOpen;
  const headings = useRef({});
  const previousOpen = useRef(open);

  // Keep the hash in step with the open step (replace, so the bad hash is not a Back stop).
  useEffect(() => {
    if (requested !== open) navigate({ pathname: location.pathname, search: location.search, hash: `#${open}` }, { replace: true });
  }, [requested, open, navigate, location.pathname, location.search]);

  // The newly opened step's heading gets focus and scrolls into view.
  useEffect(() => {
    if (previousOpen.current === open) return;
    previousOpen.current = open;
    const heading = headings.current[open];
    if (!heading) return;
    heading.focus({ preventScroll: true });
    heading.closest(".ck-step")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open]);

  const go = useCallback(
    (id, { replace = false } = {}) => navigate({ pathname: location.pathname, search: location.search, hash: `#${id}` }, { replace }),
    [navigate, location.pathname, location.search]
  );

  // After a step: the next step that is not complete yet (payment when all are).
  const goNext = useCallback(
    (from, nowCompleted = completed) => {
      const after = IDS.slice(IDS.indexOf(from) + 1);
      go(after.find((id) => !nowCompleted[id]) || IDS[IDS.length - 1]);
    },
    [completed, go]
  );

  const status = (id) => (id === open ? "open" : completed[id] ? "done" : "locked");
  const headingRef = (id) => (element) => {
    headings.current[id] = element;
  };

  return { open, status, go, goNext, headingRef, index: IDS.indexOf(open) };
};

export default useCheckoutSteps;
