import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Container, Spinner } from "react-bootstrap";
import { FaArrowLeft, FaArrowRight, FaLock } from "react-icons/fa6";
import SeoHead from "../../components/common/SeoHead";
import { createTransferBooking, fetchTransferLocations, fetchTransferOptions, fetchTransferQuote } from "../../api/transfersApi";
import { bookingLink, bookingPayloadFor, emptyTransferForm, formatUsd, lastBookableDate, newIdempotencyKey, quoteRequestFor, zanzibarToday } from "../../utils/transferBooking";
import { STEPS, clearDraft, detailFieldsFor, furthestStep, loadDraft, relevantForm, saveDraft, stepErrors, stepIndex } from "../../utils/transferWizard";
import { StepProgress } from "./transfers/fields";
import { DetailsStep, ReviewStep, TripFacts, TripStep, VehicleStep } from "./transfers/steps";
import { SummaryBar, SummaryCard } from "./transfers/TransferSummary";
import "./transfers.css";

const NEXT_LABELS = ["See vehicle options", "Continue to details", "Review and continue"];

// The customer transfer booking: Trip → Vehicle → Details → Review & pay. Moving between steps never creates a
// booking; the booking is created only from the last step, priced again by the server. Customers pay online
// only (Pesapal), and a booking is confirmed only after the server has verified the payment.
const TransfersPage = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState(() => loadDraft() || emptyTransferForm());
  const [locations, setLocations] = useState([]);
  const [options, setOptions] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [quote, setQuote] = useState(null);
  const [quoteState, setQuoteState] = useState("idle");
  const [quoteRetry, setQuoteRetry] = useState(0);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // One Idempotency-Key per distinct submission: a retry of the same details reuses it, an edit gets a new one.
  const submission = useRef({ key: "", payload: "" });
  const headingFocus = useRef(false);
  const today = zanzibarToday();
  const maxAdvanceDays = options?.maxAdvanceDays;

  useEffect(() => {
    const unavailable = (error) =>
      error.status === 503 ? "Transfer booking is temporarily unavailable. Please try again later." : error.message || "Could not load transfer booking.";
    fetchTransferLocations().then(setLocations).catch((error) => setLoadError(unavailable(error)));
    fetchTransferOptions().then(setOptions).catch((error) => setLoadError(unavailable(error)));
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
    for (const index of [0, 1, 2]) {
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
      navigate(bookingLink(result.reference, result.accessToken), { state: { justBooked: true } });
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

  const onSubmit = (event) => {
    event.preventDefault();
    if (current === 3) submit();
    else next();
  };

  const stepProps = { form: submitted, set, errors, locations };
  const finalLabel = priced ? `Pay ${formatUsd(quote.total)} with Pesapal` : "Send quote request";

  return (
    <div className="tw-page">
      <SeoHead
        title="Zanzibar Airport & Hotel Transfers | Riser Tours & Safaris"
        description="Book private Zanzibar airport, port and hotel transfers. Instant prices per vehicle for one-way and round trips."
      />
      <div className="tw-progress-bar">
        <Container>
          <StepProgress current={current} onGo={goTo} />
        </Container>
      </div>

      <Container className="tw-body">
        {loadError ? <Alert variant="warning" role="alert">{loadError}</Alert> : null}
        <div className="tw-layout">
          <div className="tw-main">
            <SummaryBar form={submitted} locations={locations} quote={quote} quoteState={quoteState} />
            <form id="transfer-booking-form" className="tw-card" noValidate onSubmit={onSubmit}>
              {waiting ? (
                <div className="tw-loading" role="status"><Spinner animation="border" size="sm" /> Loading your booking…</div>
              ) : current === 0 ? (
                <TripStep {...stepProps} today={today} lastDate={lastBookableDate(maxAdvanceDays)} />
              ) : current === 1 ? (
                <VehicleStep {...stepProps} quote={quote} quoteState={quoteState} onRetryQuote={() => setQuoteRetry((count) => count + 1)} />
              ) : current === 2 ? (
                <DetailsStep {...stepProps} fields={fields} />
              ) : (
                <ReviewStep {...stepProps} quote={quote} quoteState={quoteState} payment={options?.payment} goTo={goTo} fields={fields} />
              )}

              {notice ? <Alert variant="info" role="status" className="mt-3 mb-0">{notice}</Alert> : null}
              {submitError ? <Alert variant="danger" role="alert" className="mt-3 mb-0">{submitError}</Alert> : null}

              <div className="tw-actions">
                {current > 0 ? (
                  <button type="button" className="tw-btn tw-btn-ghost" onClick={() => goTo(current - 1)}>
                    <FaArrowLeft aria-hidden="true" /> Back
                  </button>
                ) : null}
                {current < 3 ? (
                  <button type="submit" className="tw-btn tw-btn-primary" disabled={waiting || (current === 1 && quoteState !== "ready") || Boolean(loadError)}>
                    {NEXT_LABELS[current]} <FaArrowRight aria-hidden="true" />
                  </button>
                ) : (
                  <button type="submit" className="tw-btn tw-btn-primary" disabled={submitting || quoteState !== "ready" || !canSubmit}>
                    {priced ? <FaLock aria-hidden="true" /> : null}
                    {submitting ? "Sending…" : finalLabel}
                    {submitting ? null : <FaArrowRight aria-hidden="true" />}
                  </button>
                )}
              </div>
              {current === 0 ? <TripFacts /> : null}
            </form>
          </div>
          <div className="tw-side">
            <SummaryCard form={submitted} locations={locations} quote={quote} quoteState={quoteState} />
          </div>
        </div>
      </Container>
    </div>
  );
};

export default TransfersPage;
