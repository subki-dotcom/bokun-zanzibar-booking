import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Container, Spinner } from "react-bootstrap";
import { FaArrowLeft, FaArrowRight, FaLock } from "react-icons/fa6";
import SeoHead from "../../components/common/SeoHead";
import { createTransferBooking, fetchPopularRoutes, fetchTransferLocations, fetchTransferOptions, fetchTransferQuote, startTransferPayment } from "../../api/transfersApi";
import { TRIP_TYPES, bookingLink, bookingPayloadFor, emptyTransferForm, formatUsd, goToPesapal, lastBookableDate, newIdempotencyKey, quoteRequestFor, zanzibarToday } from "../../utils/transferBooking";
import { STEPS, clearDraft, detailFieldsFor, furthestStep, loadDraft, relevantForm, saveDraft, stepErrors, stepIndex } from "../../utils/transferWizard";
import { StepProgress } from "./transfers/fields";
import { DetailsStep, ReviewStep, TripFacts, TripStep, VehicleStep } from "./transfers/steps";
import { SummaryBar, SummaryCard } from "./transfers/TransferSummary";
import PopularRoutes from "./transfers/PopularRoutes";
import "./transfers.css";

const NEXT_LABELS = ["Search Availability", "Continue to details", "Continue to payment"];
// The yellow tab on the booking widget, one per step.
const TABS = ["Search for availability", "Choose your vehicle", "Passenger details", "Secure online payment"];

// The customer transfer booking: Search → Vehicle → Details → Payment, then Confirmed on the payment return page
// once the server has verified the payment with Pesapal. Moving between steps never creates a booking; the booking
// is created only from the payment step, priced again by the server. Customers pay online only (Pesapal).
const TransfersPage = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState(() => loadDraft() || emptyTransferForm());
  const [locations, setLocations] = useState([]);
  const [options, setOptions] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [popular, setPopular] = useState({ state: "loading", routes: [] });
  const [quote, setQuote] = useState(null);
  const [quoteState, setQuoteState] = useState("idle");
  const [quoteRetry, setQuoteRetry] = useState(0);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // One Idempotency-Key per distinct submission: a retry of the same details reuses it, an edit gets a new one.
  const submission = useRef({ key: "", payload: "" });
  const [openingPesapal, setOpeningPesapal] = useState(false);
  const headingFocus = useRef(false);
  const today = zanzibarToday();
  const maxAdvanceDays = options?.maxAdvanceDays;

  useEffect(() => {
    const unavailable = (error) =>
      error.status === 503 ? "Transfer booking is temporarily unavailable. Please try again later." : error.message || "Could not load transfer booking.";
    fetchTransferLocations().then(setLocations).catch((error) => setLoadError(unavailable(error)));
    fetchTransferOptions().then(setOptions).catch((error) => setLoadError(unavailable(error)));
    fetchPopularRoutes()
      .then((routes) => setPopular({ state: "ready", routes }))
      .catch(() => setPopular({ state: "error", routes: [] }));
  }, []);

  useEffect(() => saveDraft(form), [form]);

  const quoteRequest = useMemo(() => quoteRequestFor(form), [form]);
  const quoteKey = quoteRequest ? JSON.stringify(quoteRequest) : "";

  useEffect(() => {
    if (!quoteRequest) {
      setQuote(null);
      setQuoteState("idle");
      return undefined;
    }
    let active = true;
    setQuoteState("loading");
    const timer = setTimeout(() => {
      fetchTransferQuote(quoteRequest)
        .then((result) => active && (setQuote(result), setQuoteState("ready")))
        .catch(() => active && (setQuote(null), setQuoteState("error")));
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // quoteKey captures every field that affects the price.
  }, [quoteKey, quoteRetry]);

  const locationType = (id) => locations.find((location) => location.id === id)?.type;
  const fields = detailFieldsFor(locationType(form.pickupLocationId), locationType(form.dropoffLocationId));
  const submitted = relevantForm(form, fields);
  const rules = { maxAdvanceDays, quote, quoteState };

  // The step in the address bar, but never past the first step whose details are still missing.
  const requested = stepIndex(params.get("step"));
  const allowed = furthestStep(submitted, rules);
  const current = allowed === null ? (requested > 0 ? requested : 0) : Math.min(requested, allowed);
  const waiting = allowed === null && requested > 0;

  useEffect(() => {
    if (allowed !== null && requested > allowed) {
      setParams(allowed ? { step: STEPS[allowed].id } : {}, { replace: true });
    }
  }, [allowed, requested, setParams]);

  // Each step change moves keyboard and screen-reader focus to the new step's heading.
  useEffect(() => {
    if (!headingFocus.current) {
      headingFocus.current = true;
      return;
    }
    window.scrollTo({ top: 0, behavior: "auto" });
    document.getElementById("transfer-step-heading")?.focus({ preventScroll: true });
  }, [current]);

  const set = (field) => (value) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined, ...(field.startsWith("phone") ? { phone: undefined } : {}) }));
    setNotice("");
  };

  const goTo = (index) => {
    setErrors({});
    setSubmitError("");
    setParams(index ? { step: STEPS[index].id } : {});
  };

  const focusFirstError = (found) => {
    const [first] = Object.keys(found);
    const target = { phone: "transfer-phone" }[first] || `transfer-${first}`;
    setTimeout(() => document.getElementById(target)?.focus(), 0);
  };

  const next = () => {
    const found = stepErrors(current, submitted, rules);
    setErrors(found);
    if (Object.keys(found).length) {
      focusFirstError(found);
      return;
    }
    goTo(current + 1);
  };

  const priced = quote?.status === "PRICED";
  const canSubmit = !priced || Boolean(options?.payment?.onlineAvailable);

  const submit = async () => {
    setSubmitError("");
    setNotice("");
    for (const index of [0, 1, 2, 3]) {
      const found = stepErrors(index, submitted, rules);
      if (Object.keys(found).length) {
        goTo(index);
        setErrors(found);
        return;
      }
    }
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // The customer confirms the price they see now: check it with the server before anything is created.
      const fresh = await fetchTransferQuote(quoteRequestFor(submitted));
      if (fresh.status !== quote.status || fresh.total !== quote.total) {
        setQuote(fresh);
        setNotice(
          fresh.status === "PRICED"
            ? `The price for this trip is now ${formatUsd(fresh.total)}. Please check the new total before you continue.`
            : "This trip now needs a quote from our team. Please check the details before you continue."
        );
        return;
      }
      const payload = bookingPayloadFor(submitted, fresh);
      const serialized = JSON.stringify(payload);
      if (submission.current.payload !== serialized) submission.current = { key: newIdempotencyKey(), payload: serialized };
      const result = await createTransferBooking(payload, submission.current.key);
      clearDraft();
      if (result.booking.status !== "AWAITING_PAYMENT") {
        navigate(bookingLink(result.reference, result.accessToken), { state: { justBooked: true } });
        return;
      }
      // The booking exists now; pay it on Pesapal. If Pesapal cannot be opened, the booking page offers to try again.
      setOpeningPesapal(true);
      try {
        await goToPesapal({ reference: result.reference, accessToken: result.accessToken, start: startTransferPayment });
      } catch (paymentError) {
        setOpeningPesapal(false);
        navigate(bookingLink(result.reference, result.accessToken), { state: { justBooked: true, paymentError: paymentError.message || "Pesapal could not be opened." } });
      }
    } catch (error) {
      if (error.code === "TRANSFER_PRICE_CHANGED" && error.details?.quote) {
        setQuote(error.details.quote);
        setNotice(
          error.details.quote.status === "PRICED"
            ? `The price for this trip is now ${formatUsd(error.details.quote.total)}. Please check the new total before you continue.`
            : "This trip now needs a quote from our team. Please check the details before you continue."
        );
      } else if (error.details?.fieldErrors) {
        setSubmitError("Some details were not accepted. Please check each step and try again.");
      } else {
        setSubmitError(error.message || "Could not send your booking. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Book Now on a popular route: the same widget, with its places filled in as a one-way trip. The customer picks the
  // date, time and travelers, and can still change the places. Prices come from the server as for any search.
  const bookRoute = (route) => {
    setForm((previous) => ({
      ...previous,
      tripType: TRIP_TYPES.ONE_WAY,
      pickupLocationId: route.pickup.id,
      dropoffLocationId: route.dropoff.id,
      returnDate: "",
      returnTime: "",
      vehicleOption: ""
    }));
    setErrors({});
    setNotice(`${route.title}: choose your travel date, pick-up time and travelers.`);
    setParams({ route: route.slug });
    setTimeout(() => {
      document.querySelector(".tw-widget")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("transfer-travelDate")?.focus({ preventScroll: true });
    }, 0);
  };

  // A link to /transfers?route=<slug> (from another page) opens the widget with that route filled in, once.
  const linkedRoute = params.get("route");
  const appliedRoute = useRef("");
  useEffect(() => {
    if (!linkedRoute || appliedRoute.current === linkedRoute || popular.state !== "ready") return;
    appliedRoute.current = linkedRoute;
    const route = popular.routes.find((item) => item.slug === linkedRoute);
    if (route && (form.pickupLocationId !== route.pickup.id || form.dropoffLocationId !== route.dropoff.id)) bookRoute(route);
    // bookRoute only uses state setters; the form is read once when the link is opened.
  }, [linkedRoute, popular]);

  const onSubmit = (event) => {
    event.preventDefault();
    if (current === 3) submit();
    else next();
  };

  const stepProps = { form: submitted, set, errors, locations };
  const finalLabel = priced ? `Pay Securely ${formatUsd(quote.total)}` : "Send quote request";
  const messages = (
    <>
      {notice ? <Alert variant="info" role="status" className="mt-3 mb-0">{notice}</Alert> : null}
      {submitError ? <Alert variant="danger" role="alert" className="mt-3 mb-0">{submitError}</Alert> : null}
    </>
  );

  return (
    <div className="tw-page">
      <SeoHead
        title="Zanzibar Airport & Hotel Transfers | Riser Tours & Safaris"
        description="Book private Zanzibar airport, port and hotel transfers. Instant prices per vehicle for one-way and round trips."
      />
      <Container className="tw-body">
        <section className="tw-widget" aria-label="Transfer booking">
          {/* The step heading itself is the h1 below; the tab repeats it as a visual label. */}
          <p className="tw-widget-tab" aria-hidden="true">{TABS[current]}</p>
          <StepProgress current={current} onGo={goTo} />
          {loadError ? <Alert variant="warning" role="alert" className="mb-0 mt-3">{loadError}</Alert> : null}
          {current === 0 && !waiting ? (
            <form id="transfer-booking-form" className="tw-search" noValidate onSubmit={onSubmit}>
              <TripStep {...stepProps} today={today} lastDate={lastBookableDate(maxAdvanceDays)} />
              {messages}
            </form>
          ) : null}
        </section>

        {current === 0 && !waiting ? (
          <>
            <PopularRoutes routes={popular.routes} state={popular.state} onBook={bookRoute} />
            <TripFacts />
          </>
        ) : (
          <div className="tw-layout">
            <div className="tw-main">
              <SummaryBar form={submitted} locations={locations} quote={quote} quoteState={quoteState} />
              <form id="transfer-booking-form" className="tw-card" noValidate onSubmit={onSubmit}>
                {waiting ? (
                  <div className="tw-loading" role="status"><Spinner animation="border" size="sm" /> Loading your booking…</div>
                ) : current === 1 ? (
                  <VehicleStep {...stepProps} quote={quote} quoteState={quoteState} onRetryQuote={() => setQuoteRetry((count) => count + 1)} />
                ) : current === 2 ? (
                  <DetailsStep {...stepProps} fields={fields} goTo={goTo} />
                ) : (
                  <ReviewStep {...stepProps} quote={quote} quoteState={quoteState} payment={options?.payment} goTo={goTo} fields={fields} />
                )}
                {messages}
                <div className="tw-actions">
                  <button type="button" className="tw-btn tw-btn-ghost" onClick={() => goTo(current - 1)}>
                    <FaArrowLeft aria-hidden="true" /> Back
                  </button>
                  {current < 3 ? (
                    <button type="submit" className="tw-btn tw-btn-primary" disabled={waiting || (current === 1 && quoteState !== "ready") || Boolean(loadError)}>
                      {NEXT_LABELS[current]} <FaArrowRight aria-hidden="true" />
                    </button>
                  ) : (
                    <button type="submit" className="tw-btn tw-btn-primary" disabled={submitting || openingPesapal || quoteState !== "ready" || !canSubmit}>
                      {priced ? <FaLock aria-hidden="true" /> : null}
                      {openingPesapal ? "Opening Pesapal…" : submitting ? "Sending…" : finalLabel}
                      {submitting ? null : <FaArrowRight aria-hidden="true" />}
                    </button>
                  )}
                </div>
              </form>
            </div>
            <div className="tw-side">
              <SummaryCard form={submitted} locations={locations} quote={quote} quoteState={quoteState} />
            </div>
          </div>
        )}
      </Container>
    </div>
  );
};

export default TransfersPage;
