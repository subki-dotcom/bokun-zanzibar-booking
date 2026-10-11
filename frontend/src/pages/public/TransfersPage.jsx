import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Col, Container, Form, Row, Spinner } from "react-bootstrap";
import { FiArrowRight, FiMinus, FiPlus, FiRepeat, FiShield } from "react-icons/fi";
import SeoHead from "../../components/common/SeoHead";
import { createTransferBooking, fetchTransferLocations, fetchTransferQuote } from "../../api/transfersApi";
import {
  TRIP_TYPES,
  bookingLink,
  bookingPayloadFor,
  emptyTransferForm,
  formatUsd,
  newIdempotencyKey,
  passengerSummary,
  quoteRequestFor,
  validateTransferForm,
  zanzibarToday
} from "../../utils/transferBooking";
import "./transfers.css";

const LOCATION_GROUPS = [
  ["AIRPORT", "Airports"],
  ["PORT", "Ports & ferry terminals"],
  ["HOTEL", "Hotels"],
  ["AREA", "Areas"],
  ["OTHER", "Other places"]
];

const Counter = ({ id, label, hint, value, min = 0, max = 99, onChange, error }) => (
  <div className="transfer-counter">
    <div>
      <label htmlFor={id} className="transfer-counter-label">{label}</label>
      {hint ? <span className="transfer-counter-hint">{hint}</span> : null}
    </div>
    <div className="transfer-counter-control">
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} onClick={() => onChange(Math.max(min, Number(value) - 1))} disabled={Number(value) <= min}>
        <FiMinus aria-hidden="true" />
      </button>
      <input id={id} type="number" inputMode="numeric" min={min} max={max} value={value} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))} />
      <button type="button" aria-label={`More ${label.toLowerCase()}`} onClick={() => onChange(Math.min(max, Number(value) + 1))} disabled={Number(value) >= max}>
        <FiPlus aria-hidden="true" />
      </button>
    </div>
  </div>
);

const LocationSelect = ({ id, label, value, locations, onChange, error, exclude }) => (
  <Form.Group controlId={id}>
    <Form.Label>{label}</Form.Label>
    <Form.Select value={value} onChange={(event) => onChange(event.target.value)} isInvalid={Boolean(error)} required>
      <option value="">Select a location</option>
      {LOCATION_GROUPS.map(([type, groupLabel]) => {
        const options = locations.filter((location) => location.type === type);
        return options.length ? (
          <optgroup key={type} label={groupLabel}>
            {options.map((location) => (
              <option key={location.id} value={location.id} disabled={location.id === exclude}>{location.name}</option>
            ))}
          </optgroup>
        ) : null;
      })}
    </Form.Select>
    <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
  </Form.Group>
);

const PriceSummary = ({ form, locations, quote, quoteState, submitting, unavailable }) => {
  const name = (id) => locations.find((location) => location.id === id)?.name || "—";
  const priced = quote?.status === "PRICED";
  return (
    <aside className="transfer-summary" aria-live="polite">
      <h2 className="transfer-summary-title">Your transfer</h2>
      <dl className="transfer-summary-list">
        <div><dt>Trip</dt><dd>{form.tripType === TRIP_TYPES.ROUND_TRIP ? "Round trip" : "One way"}</dd></div>
        <div><dt>From</dt><dd>{name(form.pickupLocationId)}</dd></div>
        <div><dt>To</dt><dd>{name(form.dropoffLocationId)}</dd></div>
        <div><dt>Passengers</dt><dd>{passengerSummary({ adults: Number(form.adults) || 0, children: Number(form.children) || 0, infants: Number(form.infants) || 0 })}</dd></div>
      </dl>
      <div className="transfer-summary-price">
        {quoteState === "loading" ? (
          <span className="transfer-summary-muted"><Spinner animation="border" size="sm" /> Checking price…</span>
        ) : priced ? (
          <>
            <span className="transfer-summary-amount">{formatUsd(quote.total)}</span>
            <span className="transfer-summary-muted">
              Price per vehicle{quote.legs.length > 1 ? `, both ways (${formatUsd(quote.legs[0].price)} + ${formatUsd(quote.legs[1].price)})` : ""}
            </span>
          </>
        ) : quote?.status === "QUOTE_REQUIRED" ? (
          <>
            <span className="transfer-summary-quote">Request a Quote</span>
            <span className="transfer-summary-muted">We don&apos;t have a set price for this trip yet. Send your request and our team will reply with a price.</span>
          </>
        ) : (
          <span className="transfer-summary-muted">Choose pickup, drop-off and passengers to see the price.</span>
        )}
      </div>
      <Button type="submit" form="transfer-booking-form" className="premium-btn text-white w-100 transfer-submit" disabled={submitting || unavailable || quoteState === "loading"}>
        {submitting ? "Sending…" : quote?.status === "QUOTE_REQUIRED" ? (
          <>Request a Quote <FiArrowRight aria-hidden="true" /></>
        ) : (
          <>Book transfer <FiArrowRight aria-hidden="true" /></>
        )}
      </Button>
      <p className="transfer-summary-note">
        <FiShield aria-hidden="true" /> {quote?.status === "QUOTE_REQUIRED" ? "No payment is taken for a quote request." : "Your booking is confirmed once payment has been received and verified."}
      </p>
    </aside>
  );
};

const TransfersPage = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyTransferForm);
  const [locations, setLocations] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [quote, setQuote] = useState(null);
  const [quoteState, setQuoteState] = useState("idle");
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // One Idempotency-Key per distinct submission: a retry of the same details reuses it, an edit gets a new one.
  const submission = useRef({ key: "", payload: "" });
  const today = zanzibarToday();

  useEffect(() => {
    fetchTransferLocations()
      .then(setLocations)
      .catch((error) => setLoadError(error.status === 503 ? "Transfer booking is temporarily unavailable. Please try again later or contact us on WhatsApp." : error.message || "Could not load locations."));
  }, []);

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
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // quoteKey captures every field that affects the price.
  }, [quoteKey]);

  const update = (field) => (value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const onInput = (field) => (event) => update(field)(event.target.type === "checkbox" ? event.target.checked : event.target.value);

  const swap = () => setForm((current) => ({ ...current, pickupLocationId: current.dropoffLocationId, dropoffLocationId: current.pickupLocationId }));

  const submit = async (event) => {
    event?.preventDefault();
    setSubmitError("");
    setNotice("");
    const found = validateTransferForm(form);
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(`transfer-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    if (!quote || quoteState !== "ready") {
      setSubmitError("We are still checking the price. Please wait a moment and try again.");
      return;
    }
    const payload = bookingPayloadFor(form, quote);
    const serialized = JSON.stringify(payload);
    if (submission.current.payload !== serialized) submission.current = { key: newIdempotencyKey(), payload: serialized };

    setSubmitting(true);
    try {
      const result = await createTransferBooking(payload, submission.current.key);
      navigate(bookingLink(result.reference, result.accessToken), { state: { justBooked: true } });
    } catch (error) {
      if (error.code === "TRANSFER_PRICE_CHANGED" && error.details?.quote) {
        setQuote(error.details.quote);
        setNotice(
          error.details.quote.status === "PRICED"
            ? `The price for this trip is now ${formatUsd(error.details.quote.total)}. Please review it and submit again.`
            : "This trip now needs a quote. Please review and submit your request again."
        );
      } else if (error.details?.fieldErrors) {
        setSubmitError("Please check the highlighted details and try again.");
      } else {
        setSubmitError(error.message || "Could not send your booking. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const roundTrip = form.tripType === TRIP_TYPES.ROUND_TRIP;

  return (
    <div className="transfer-page">
      <SeoHead
        title="Zanzibar Airport & Hotel Transfers | Riser Tours & Safaris"
        description="Book private Zanzibar airport, port and hotel transfers. Instant prices per vehicle for one-way and round trips."
      />
      <section className="transfer-hero">
        <Container>
          <p className="transfer-eyebrow">Private transfers</p>
          <h1>Zanzibar airport &amp; hotel transfers</h1>
          <p className="transfer-hero-lead">One price per vehicle, not per person. Choose your route and see the price instantly.</p>
        </Container>
      </section>

      <Container className="transfer-body">
        {loadError ? <Alert variant="warning" role="alert">{loadError}</Alert> : null}
        <Row className="g-4">
          <Col lg={8}>
            <Form id="transfer-booking-form" noValidate onSubmit={submit} className="transfer-form">
              <section className="transfer-card" aria-labelledby="transfer-trip-heading">
                <h2 id="transfer-trip-heading" className="transfer-card-title"><span>1</span> Your trip</h2>
                <div className="transfer-trip-type" role="radiogroup" aria-label="Trip type">
                  {[[TRIP_TYPES.ONE_WAY, "One way"], [TRIP_TYPES.ROUND_TRIP, "Round trip"]].map(([value, label]) => (
                    <label key={value} className={`transfer-trip-option ${form.tripType === value ? "is-active" : ""}`}>
                      <input type="radio" name="tripType" value={value} checked={form.tripType === value} onChange={() => update("tripType")(value)} />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="transfer-route">
                  <LocationSelect id="transfer-pickupLocationId" label="Pickup location" value={form.pickupLocationId} locations={locations} onChange={update("pickupLocationId")} error={errors.pickupLocationId} exclude={form.dropoffLocationId} />
                  <button type="button" className="transfer-swap" onClick={swap} aria-label="Swap pickup and drop-off" title="Swap pickup and drop-off">
                    <FiRepeat aria-hidden="true" />
                  </button>
                  <LocationSelect id="transfer-dropoffLocationId" label="Drop-off location" value={form.dropoffLocationId} locations={locations} onChange={update("dropoffLocationId")} error={errors.dropoffLocationId} exclude={form.pickupLocationId} />
                </div>
                <Row className="g-3 mt-1">
                  <Col sm={6}>
                    <Form.Group controlId="transfer-travelDate">
                      <Form.Label>Travel date</Form.Label>
                      <Form.Control type="date" min={today} value={form.travelDate} onChange={onInput("travelDate")} isInvalid={Boolean(errors.travelDate)} required />
                      <Form.Control.Feedback type="invalid">{errors.travelDate}</Form.Control.Feedback>
                    </Form.Group>
                  </Col>
                  <Col sm={6}>
                    <Form.Group controlId="transfer-travelTime">
                      <Form.Label>Pickup time</Form.Label>
                      <Form.Control type="time" value={form.travelTime} onChange={onInput("travelTime")} isInvalid={Boolean(errors.travelDate)} required />
                      <Form.Text>Zanzibar time (EAT)</Form.Text>
                    </Form.Group>
                  </Col>
                  {roundTrip ? (
                    <>
                      <Col sm={6}>
                        <Form.Group controlId="transfer-returnDate">
                          <Form.Label>Return date</Form.Label>
                          <Form.Control type="date" min={form.travelDate || today} value={form.returnDate} onChange={onInput("returnDate")} isInvalid={Boolean(errors.returnDate)} required />
                          <Form.Control.Feedback type="invalid">{errors.returnDate}</Form.Control.Feedback>
                        </Form.Group>
                      </Col>
                      <Col sm={6}>
                        <Form.Group controlId="transfer-returnTime">
                          <Form.Label>Return pickup time</Form.Label>
                          <Form.Control type="time" value={form.returnTime} onChange={onInput("returnTime")} isInvalid={Boolean(errors.returnDate)} required />
                        </Form.Group>
                      </Col>
                    </>
                  ) : null}
                  <Col sm={6}>
                    <Form.Group controlId="transfer-pickupAddress">
                      <Form.Label>Hotel / exact pickup address</Form.Label>
                      <Form.Control value={form.pickupAddress} onChange={onInput("pickupAddress")} maxLength={300} placeholder="e.g. Arrivals hall, or hotel name and room" />
                    </Form.Group>
                  </Col>
                  <Col sm={6}>
                    <Form.Group controlId="transfer-dropoffAddress">
                      <Form.Label>Hotel / exact drop-off address <span className="transfer-optional">(optional)</span></Form.Label>
                      <Form.Control value={form.dropoffAddress} onChange={onInput("dropoffAddress")} maxLength={300} placeholder="e.g. hotel name" />
                    </Form.Group>
                  </Col>
                  <Col sm={6}>
                    <Form.Group controlId="transfer-flightNumber">
                      <Form.Label>Flight number <span className="transfer-optional">(if flying)</span></Form.Label>
                      <Form.Control value={form.flightNumber} onChange={onInput("flightNumber")} maxLength={12} placeholder="e.g. PW 1234" isInvalid={Boolean(errors.flightNumber)} autoCapitalize="characters" />
                      <Form.Control.Feedback type="invalid">{errors.flightNumber}</Form.Control.Feedback>
                    </Form.Group>
                  </Col>
                </Row>
              </section>

              <section className="transfer-card" aria-labelledby="transfer-pax-heading">
                <h2 id="transfer-pax-heading" className="transfer-card-title"><span>2</span> Passengers &amp; luggage</h2>
                <div className="transfer-counters">
                  <Counter id="transfer-adults" label="Adults" hint="12+ years" value={form.adults} min={1} onChange={update("adults")} error={errors.adults} />
                  <Counter id="transfer-children" label="Children" hint="4–11 years" value={form.children} onChange={update("children")} error={errors.children} />
                  <Counter id="transfer-infants" label="Infants" hint="0–3 years · need a seat in the vehicle" value={form.infants} onChange={update("infants")} error={errors.infants} />
                </div>
                {errors.adults ? <div className="transfer-error" role="alert">{errors.adults}</div> : null}
                <div className="transfer-counters">
                  <Counter id="transfer-largeBags" label="Large bags" hint="Suitcases" value={form.largeBags} max={40} onChange={update("largeBags")} />
                  <Counter id="transfer-smallBags" label="Small bags" hint="Hand luggage, backpacks" value={form.smallBags} max={40} onChange={update("smallBags")} />
                </div>
                <Form.Group controlId="transfer-luggageNotes" className="mt-3">
                  <Form.Label>Other luggage <span className="transfer-optional">(optional)</span></Form.Label>
                  <Form.Control value={form.luggageNotes} onChange={onInput("luggageNotes")} maxLength={300} placeholder="e.g. surfboard, pram, wheelchair" />
                </Form.Group>
              </section>

              <section className="transfer-card" aria-labelledby="transfer-contact-heading">
                <h2 id="transfer-contact-heading" className="transfer-card-title"><span>3</span> Your details</h2>
                <Row className="g-3">
                  <Col sm={6}>
                    <Form.Group controlId="transfer-fullName">
                      <Form.Label>Full name</Form.Label>
                      <Form.Control value={form.fullName} onChange={onInput("fullName")} autoComplete="name" maxLength={120} isInvalid={Boolean(errors.fullName)} required />
                      <Form.Control.Feedback type="invalid">{errors.fullName}</Form.Control.Feedback>
                    </Form.Group>
                  </Col>
                  <Col sm={6}>
                    <Form.Group controlId="transfer-email">
                      <Form.Label>Email</Form.Label>
                      <Form.Control type="email" value={form.email} onChange={onInput("email")} autoComplete="email" maxLength={200} isInvalid={Boolean(errors.email)} required />
                      <Form.Control.Feedback type="invalid">{errors.email}</Form.Control.Feedback>
                    </Form.Group>
                  </Col>
                  <Col sm={6}>
                    <Form.Group controlId="transfer-phone">
                      <Form.Label>Phone / WhatsApp</Form.Label>
                      <Form.Control type="tel" value={form.phone} onChange={onInput("phone")} autoComplete="tel" placeholder="+255 7XX XXX XXX" maxLength={24} isInvalid={Boolean(errors.phone)} required />
                      <Form.Control.Feedback type="invalid">{errors.phone}</Form.Control.Feedback>
                    </Form.Group>
                  </Col>
                  <Col sm={6} className="d-flex align-items-end">
                    <Form.Check id="transfer-whatsapp" type="checkbox" label="This number is on WhatsApp" checked={form.whatsapp} onChange={onInput("whatsapp")} />
                  </Col>
                  <Col xs={12}>
                    <Form.Group controlId="transfer-specialRequests">
                      <Form.Label>Special requests <span className="transfer-optional">(optional)</span></Form.Label>
                      <Form.Control as="textarea" rows={3} value={form.specialRequests} onChange={onInput("specialRequests")} maxLength={1000} placeholder="e.g. child seat, name sign, extra stop" />
                    </Form.Group>
                  </Col>
                </Row>
                {/* Honeypot: hidden from people and screen readers; bots that fill it are rejected. */}
                <div className="transfer-hp" aria-hidden="true">
                  <label htmlFor="transfer-website">Website</label>
                  <input id="transfer-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={onInput("website")} />
                </div>
              </section>

              {notice ? <Alert variant="info" role="status">{notice}</Alert> : null}
              {submitError ? <Alert variant="danger" role="alert">{submitError}</Alert> : null}
              {quoteState === "error" ? <Alert variant="warning" role="alert">We could not check the price right now. Please try again in a moment.</Alert> : null}
            </Form>
          </Col>
          <Col lg={4}>
            <div className="transfer-summary-wrap">
              <PriceSummary form={form} locations={locations} quote={quote} quoteState={quoteState} submitting={submitting} unavailable={Boolean(loadError)} />
            </div>
          </Col>
        </Row>
      </Container>
    </div>
  );
};

export default TransfersPage;
