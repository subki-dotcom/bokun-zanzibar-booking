import { Spinner } from "react-bootstrap";
import { FaChevronDown } from "react-icons/fa6";
import { TRIP_TYPES, formatUsd, passengerSummary } from "../../../utils/transferBooking";
import { PRIVATE_VEHICLE } from "../../../utils/transferWizard";

// "2026-11-14" + "14:30" → "Fri, 14 Nov 2026, 14:30" (the date and time are already Zanzibar time).
export const formatTripDate = (date, time) => {
  if (!date) return "";
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return `${date} ${time || ""}`.trim();
  const day = parsed.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return time ? `${day}, ${time}` : day;
};

export const passengersOf = (form) => ({ adults: Number(form.adults) || 0, children: Number(form.children) || 0, infants: Number(form.infants) || 0 });

const nameOf = (locations, id) => locations.find((location) => location.id === id)?.name || "";

// The price block: every amount is the server's quote.
export const PriceLines = ({ quote, quoteState }) => {
  if (quoteState === "loading") {
    return <div className="tw-summary-muted tw-price-checking" role="status"><Spinner animation="border" size="sm" /> Checking the price…</div>;
  }
  if (quote?.status === "PRICED") {
    const roundTrip = quote.legs.length > 1;
    return (
      <div className="tw-price">
        {roundTrip ? (
          <dl className="tw-price-legs">
            <div><dt>Outbound transfer</dt><dd>{formatUsd(quote.legs[0].price)}</dd></div>
            <div><dt>Return transfer</dt><dd>{formatUsd(quote.legs[1].price)}</dd></div>
          </dl>
        ) : null}
        <div className="tw-price-total">
          <span>Total</span>
          <span className="tw-price-amount">{formatUsd(quote.total)}<small>Price per vehicle</small></span>
        </div>
      </div>
    );
  }
  if (quote?.status === "QUOTE_REQUIRED") {
    return (
      <div className="tw-price">
        <div className="tw-price-total"><span>Price</span><span className="tw-price-quote">On request</span></div>
        <p className="tw-summary-muted mb-0">There is no set price for this trip yet. Our team will price it for you.</p>
      </div>
    );
  }
  if (quoteState === "error") return <p className="tw-summary-muted">We could not check the price right now.</p>;
  return <p className="tw-summary-muted">Choose your places and passengers to see the price.</p>;
};

const SummaryRows = ({ form, locations, quote }) => {
  const roundTrip = form.tripType === TRIP_TYPES.ROUND_TRIP;
  const vehicle = quote?.status === "PRICED" && form.vehicleOption === PRIVATE_VEHICLE ? "Private vehicle" : "";
  return (
    <dl className="tw-summary-rows">
      <div><dt>Trip type</dt><dd>{roundTrip ? "Two Ways" : "One Way"}</dd></div>
      <div><dt>From</dt><dd>{nameOf(locations, form.pickupLocationId) || "—"}</dd></div>
      <div><dt>To</dt><dd>{nameOf(locations, form.dropoffLocationId) || "—"}</dd></div>
      <div><dt>{roundTrip ? "Arrival" : "Date & time"}</dt><dd>{formatTripDate(form.travelDate, form.travelTime) || "—"}</dd></div>
      {roundTrip ? <div><dt>Return</dt><dd>{formatTripDate(form.returnDate, form.returnTime) || "—"}</dd></div> : null}
      <div><dt>Passengers</dt><dd>{passengerSummary(passengersOf(form))}</dd></div>
      <div><dt>Large bags</dt><dd>{Number(form.largeBags) || 0}</dd></div>
      <div><dt>Small bags</dt><dd>{Number(form.smallBags) || 0}</dd></div>
      {vehicle ? <div><dt>Vehicle</dt><dd>{vehicle}</dd></div> : null}
    </dl>
  );
};

const routeOf = (form, locations) => {
  const from = nameOf(locations, form.pickupLocationId);
  const to = nameOf(locations, form.dropoffLocationId);
  return from && to ? `${from} to ${to}` : "Choose where you are going";
};

// Desktop: a sticky card beside the form.
export const SummaryCard = ({ form, locations, quote, quoteState }) => {
  const route = routeOf(form, locations);
  return (
    <aside className="tw-summary" aria-label="Your transfer">
      <div className="tw-summary-band">
        <h2>Trip summary</h2>
        <p>{route}</p>
      </div>
      <div className="tw-summary-body">
        <SummaryRows form={form} locations={locations} quote={quote} />
        <div aria-live="polite"><PriceLines quote={quote} quoteState={quoteState} /></div>
      </div>
    </aside>
  );
};

// Phones and tablets: a compact bar above the form that opens to the same details.
export const SummaryBar = ({ form, locations, quote, quoteState }) => {
  const route = routeOf(form, locations);
  const headline = quote?.status === "PRICED" ? formatUsd(quote.total) : quote?.status === "QUOTE_REQUIRED" ? "Price on request" : "";
  return (
    <details className="tw-summary-mobile">
      <summary>
        <span className="tw-summary-mobile-title">
          <strong>Trip summary</strong>
          <span>{route}</span>
        </span>
        <span className="tw-summary-mobile-total">{headline}</span>
        <FaChevronDown className="tw-summary-mobile-chevron" aria-hidden="true" />
      </summary>
      <div className="tw-summary-body">
        <SummaryRows form={form} locations={locations} quote={quote} />
        <PriceLines quote={quote} quoteState={quoteState} />
      </div>
    </details>
  );
};
