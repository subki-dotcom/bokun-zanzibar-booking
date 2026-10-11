import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Col, Form, Row, Spinner } from "react-bootstrap";
import { createManualBooking, fetchLocations, previewPrice } from "../api/transferAdminApi";
import { ErrorMessage, PageHeader, useResource } from "../components/ui";
import { CHANNELS, LOCATION_TYPES, newIdempotencyKey, usd, zanzibarToday } from "../lib/format";
import { buildManualBooking, quoteRequestFor } from "../lib/manualBooking";

const empty = {
  manualChannel: "WHATSAPP",
  tripType: "ONE_WAY",
  pickupLocationId: "",
  dropoffLocationId: "",
  travelDate: "",
  travelTime: "",
  returnDate: "",
  returnTime: "",
  adults: 1,
  children: 0,
  infants: 0,
  largeBags: 0,
  smallBags: 0,
  luggageNotes: "",
  flightNumber: "",
  pickupAddress: "",
  dropoffAddress: "",
  fullName: "",
  email: "",
  phone: "",
  whatsapp: true,
  specialRequests: ""
};

const NewBookingPage = () => {
  const navigate = useNavigate();
  const { data: locationData, error: locationError } = useResource(() => fetchLocations({ active: true, limit: 100 }), []);
  const locations = (locationData?.items || []).filter((location) => location.zone?.active !== false);
  const [form, setForm] = useState(empty);
  const [quote, setQuote] = useState(null);
  const [quoteState, setQuoteState] = useState("idle");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");
  const [duplicate, setDuplicate] = useState(null);
  const [duplicateReason, setDuplicateReason] = useState("");
  const [busy, setBusy] = useState(false);
  // One Idempotency-Key per distinct submission, so a double click or a retry cannot create two bookings.
  const submission = useRef({ key: "", payload: "" });

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
      previewPrice(quoteRequest)
        .then((result) => active && (setQuote(result), setQuoteState("ready")))
        .catch(() => active && (setQuote(null), setQuoteState("error")));
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // quoteKey captures every field that affects the price.
  }, [quoteKey]);

  const set = (field) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    setDuplicate(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!quote || quoteState !== "ready") {
      setError({ message: "Wait for the price check to finish." });
      return;
    }
    const payload = buildManualBooking(form, quote, duplicate ? { allowDuplicate: true, duplicateReason } : {});
    const serialized = JSON.stringify(payload);
    if (submission.current.payload !== serialized) submission.current = { key: newIdempotencyKey(), payload: serialized };
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const result = await createManualBooking(payload, submission.current.key);
      if (!result?.id) throw new Error("The booking was saved but its details could not be opened. Find it in the bookings list.");
      navigate(`/bookings/${result.id}`);
    } catch (failure) {
      if (failure.code === "TRANSFER_POSSIBLE_DUPLICATE") {
        setDuplicate(failure.details);
      } else if (failure.code === "TRANSFER_PRICE_CHANGED" && failure.details?.quote) {
        setQuote(failure.details.quote);
        setNotice(failure.details.quote.status === "PRICED" ? `The price is now ${usd(failure.details.quote.total)}. Check it with the customer and save again.` : "This trip now needs a quote. Save again to record it as a quote request.");
      } else {
        setError(failure);
      }
    } finally {
      setBusy(false);
    }
  };

  const roundTrip = form.tripType === "ROUND_TRIP";
  const today = zanzibarToday();
  const locationOptions = LOCATION_TYPES.map(([type, label]) => {
    const options = locations.filter((location) => location.type === type);
    return options.length ? (
      <optgroup key={type} label={label}>
        {options.map((location) => <option key={location.id} value={location.id}>{location.name} ({location.zone?.code})</option>)}
      </optgroup>
    ) : null;
  });

  return (
    <>
      <PageHeader title="New booking" subtitle="For customers who book by WhatsApp, phone, email or in person. The price comes from the pricing engine." />
      <ErrorMessage error={locationError} />
      <Form onSubmit={submit}>
        <Row className="g-3">
          <Col lg={8}>
            <Card className="ta-card mb-3">
              <Card.Body>
                <h2 className="h6">Trip</h2>
                <Row className="g-3">
                  <Col sm={6}>
                    <Form.Group controlId="nb-channel">
                      <Form.Label>Booked via</Form.Label>
                      <Form.Select value={form.manualChannel} onChange={set("manualChannel")}>{CHANNELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Form.Select>
                    </Form.Group>
                  </Col>
                  <Col sm={6}>
                    <Form.Group controlId="nb-trip">
                      <Form.Label>Trip</Form.Label>
                      <Form.Select value={form.tripType} onChange={set("tripType")}>
                        <option value="ONE_WAY">One way</option>
                        <option value="ROUND_TRIP">Round trip</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col sm={6}>
                    <Form.Group controlId="nb-pickup">
                      <Form.Label>Pickup location</Form.Label>
                      <Form.Select value={form.pickupLocationId} onChange={set("pickupLocationId")} required>
                        <option value="">Select…</option>
                        {locationOptions}
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col sm={6}>
                    <Form.Group controlId="nb-dropoff">
                      <Form.Label>Drop-off location</Form.Label>
                      <Form.Select value={form.dropoffLocationId} onChange={set("dropoffLocationId")} required>
                        <option value="">Select…</option>
                        {locationOptions}
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col xs={6} sm={3}><Form.Group controlId="nb-date"><Form.Label>Date</Form.Label><Form.Control type="date" min={today} value={form.travelDate} onChange={set("travelDate")} required /></Form.Group></Col>
                  <Col xs={6} sm={3}><Form.Group controlId="nb-time"><Form.Label>Pickup time (EAT)</Form.Label><Form.Control type="time" value={form.travelTime} onChange={set("travelTime")} required /></Form.Group></Col>
                  {roundTrip ? (
                    <>
                      <Col xs={6} sm={3}><Form.Group controlId="nb-return-date"><Form.Label>Return date</Form.Label><Form.Control type="date" min={form.travelDate || today} value={form.returnDate} onChange={set("returnDate")} required /></Form.Group></Col>
                      <Col xs={6} sm={3}><Form.Group controlId="nb-return-time"><Form.Label>Return time</Form.Label><Form.Control type="time" value={form.returnTime} onChange={set("returnTime")} required /></Form.Group></Col>
                    </>
                  ) : null}
                  <Col sm={6}><Form.Group controlId="nb-pickup-address"><Form.Label>Hotel / exact pickup address</Form.Label><Form.Control value={form.pickupAddress} onChange={set("pickupAddress")} maxLength={300} /></Form.Group></Col>
                  <Col sm={6}><Form.Group controlId="nb-dropoff-address"><Form.Label>Drop-off address (optional)</Form.Label><Form.Control value={form.dropoffAddress} onChange={set("dropoffAddress")} maxLength={300} /></Form.Group></Col>
                  <Col sm={6}><Form.Group controlId="nb-flight"><Form.Label>Flight number (optional)</Form.Label><Form.Control value={form.flightNumber} onChange={set("flightNumber")} maxLength={12} /></Form.Group></Col>
                </Row>
              </Card.Body>
            </Card>
            <Card className="ta-card mb-3">
              <Card.Body>
                <h2 className="h6">Passengers &amp; luggage</h2>
                <Row className="g-3">
                  <Col xs={4}><Form.Group controlId="nb-adults"><Form.Label>Adults (12+)</Form.Label><Form.Control type="number" min={1} max={99} value={form.adults} onChange={set("adults")} required /></Form.Group></Col>
                  <Col xs={4}><Form.Group controlId="nb-children"><Form.Label>Children (4–11)</Form.Label><Form.Control type="number" min={0} max={99} value={form.children} onChange={set("children")} /></Form.Group></Col>
                  <Col xs={4}><Form.Group controlId="nb-infants"><Form.Label>Infants (0–3)</Form.Label><Form.Control type="number" min={0} max={99} value={form.infants} onChange={set("infants")} /></Form.Group></Col>
                  <Col xs={6} sm={3}><Form.Group controlId="nb-large"><Form.Label>Large bags</Form.Label><Form.Control type="number" min={0} max={40} value={form.largeBags} onChange={set("largeBags")} /></Form.Group></Col>
                  <Col xs={6} sm={3}><Form.Group controlId="nb-small"><Form.Label>Small bags</Form.Label><Form.Control type="number" min={0} max={40} value={form.smallBags} onChange={set("smallBags")} /></Form.Group></Col>
                  <Col sm={6}><Form.Group controlId="nb-luggage-notes"><Form.Label>Other luggage</Form.Label><Form.Control value={form.luggageNotes} onChange={set("luggageNotes")} maxLength={300} /></Form.Group></Col>
                </Row>
              </Card.Body>
            </Card>
            <Card className="ta-card mb-3">
              <Card.Body>
                <h2 className="h6">Customer</h2>
                <Row className="g-3">
                  <Col sm={6}><Form.Group controlId="nb-name"><Form.Label>Full name</Form.Label><Form.Control value={form.fullName} onChange={set("fullName")} minLength={2} maxLength={120} required /></Form.Group></Col>
                  <Col sm={6}><Form.Group controlId="nb-email"><Form.Label>Email</Form.Label><Form.Control type="email" value={form.email} onChange={set("email")} required /></Form.Group></Col>
                  <Col sm={6}><Form.Group controlId="nb-phone"><Form.Label>Phone / WhatsApp</Form.Label><Form.Control type="tel" value={form.phone} onChange={set("phone")} placeholder="+255 …" required /></Form.Group></Col>
                  <Col sm={6} className="d-flex align-items-end"><Form.Check id="nb-whatsapp" label="On WhatsApp" checked={form.whatsapp} onChange={set("whatsapp")} /></Col>
                  <Col xs={12}><Form.Group controlId="nb-requests"><Form.Label>Special requests</Form.Label><Form.Control as="textarea" rows={2} value={form.specialRequests} onChange={set("specialRequests")} maxLength={1000} /></Form.Group></Col>
                </Row>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={4}>
            <Card className="ta-card ta-sticky">
              <Card.Body>
                <h2 className="h6">Price</h2>
                {quoteState === "loading" ? <p><Spinner size="sm" animation="border" /> Checking…</p> : null}
                {quoteState === "error" ? <Alert variant="warning" className="small">The price could not be checked. Try again.</Alert> : null}
                {quoteState === "ready" && quote?.status === "PRICED" ? <p className="ta-price">{usd(quote.total)}<span className="d-block small text-muted">per vehicle{quote.legs.length > 1 ? ", both ways" : ""}</span></p> : null}
                {quoteState === "ready" && quote?.status === "QUOTE_REQUIRED" ? <p><strong>No rate for this trip.</strong><span className="d-block small text-muted">It will be saved as a quote request; set the price from the booking page.</span></p> : null}
                {quoteState === "idle" ? <p className="small text-muted">Choose locations and passengers to see the price.</p> : null}
                {notice ? <Alert variant="info" className="small">{notice}</Alert> : null}
                {duplicate ? (
                  <Alert variant="warning" className="small">
                    <p className="mb-2">Booking <Link to={`/bookings/${duplicate.id}`}>{duplicate.reference}</Link> already exists for this customer, pickup and time.</p>
                    <Form.Group controlId="nb-duplicate-reason">
                      <Form.Label>To create another one anyway, give a reason:</Form.Label>
                      <Form.Control as="textarea" rows={2} value={duplicateReason} onChange={(event) => setDuplicateReason(event.target.value)} maxLength={500} />
                    </Form.Group>
                  </Alert>
                ) : null}
                <ErrorMessage error={error} />
                {error?.details?.fieldErrors?.body ? <div className="small text-danger mb-2">{error.details.fieldErrors.body.join(" ")}</div> : null}
                <Button type="submit" className="w-100" disabled={busy || quoteState !== "ready" || (duplicate && duplicateReason.trim().length < 3)}>
                  {busy ? "Saving…" : duplicate ? "Create anyway" : quote?.status === "QUOTE_REQUIRED" ? "Save quote request" : "Create booking"}
                </Button>
                <p className="small text-muted mt-2 mb-0">The booking starts as awaiting payment (or quote requested). Nothing is marked paid here.</p>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Form>
    </>
  );
};

export default NewBookingPage;
