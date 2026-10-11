import { Alert, Spinner } from "react-bootstrap";
import {
  FaArrowRightArrowLeft,
  FaCalendarDays,
  FaCircleInfo,
  FaClock,
  FaCreditCard,
  FaEnvelope,
  FaLink,
  FaLock,
  FaPen,
  FaPlaneArrival,
  FaSuitcaseRolling,
  FaTag,
  FaUser,
  FaVanShuttle
} from "react-icons/fa6";
import { TRIP_TYPES, formatUsd, passengerSummary } from "../../../utils/transferBooking";
import { PRIVATE_VEHICLE } from "../../../utils/transferWizard";
import { Counter, FieldError, LocationCombobox, PhoneField } from "./fields";
import { PriceLines, formatTripDate, passengersOf } from "./TransferSummary";

export const StepHeading = ({ title, subtitle }) => (
  <header className="tw-step-header">
    <p className="tw-eyebrow">Zanzibar airport &amp; hotel transfers</p>
    <h1 id="transfer-step-heading" tabIndex={-1}>{title}</h1>
    {subtitle ? <p className="tw-step-subtitle">{subtitle}</p> : null}
  </header>
);

const TextField = ({ id, label, icon, required, optional, error, help, ...input }) => (
  <div className={`tw-field ${error ? "is-invalid" : ""}`}>
    <label htmlFor={id} className="tw-label">
      {label}
      {required ? <span className="tw-required" aria-hidden="true"> *</span> : null}
      {optional ? <span className="tw-optional"> (optional)</span> : null}
    </label>
    <div className="tw-control">
      {icon ? <span className="tw-control-icon" aria-hidden="true">{icon}</span> : null}
      <input
        id={id}
        className="tw-input"
        aria-invalid={Boolean(error)}
        aria-describedby={[help ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined}
        required={required}
        {...input}
      />
    </div>
    {help ? <div id={`${id}-help`} className="tw-help">{help}</div> : null}
    <FieldError id={`${id}-error`}>{error}</FieldError>
  </div>
);

const bagsLabel = (form) => {
  const large = Number(form.largeBags) || 0;
  const small = Number(form.smallBags) || 0;
  return `${large} large and ${small} small bag${large + small === 1 ? "" : "s"}`;
};

// ---------- Step 1: Trip ----------
export const TripStep = ({ form, set, errors, locations, today, lastDate }) => {
  const roundTrip = form.tripType === TRIP_TYPES.ROUND_TRIP;
  const swap = () => {
    set("pickupLocationId")(form.dropoffLocationId);
    set("dropoffLocationId")(form.pickupLocationId);
  };
  return (
    <>
      <StepHeading title="Where are we taking you?" subtitle="Private vehicle. One price per vehicle, not per person." />
      <div className="tw-trip-type" role="radiogroup" aria-label="Trip type">
        {[[TRIP_TYPES.ONE_WAY, "One-way"], [TRIP_TYPES.ROUND_TRIP, "Round trip"]].map(([value, label]) => (
          <label key={value} className={`tw-trip-option ${form.tripType === value ? "is-active" : ""}`}>
            <input type="radio" name="tripType" value={value} checked={form.tripType === value} onChange={() => set("tripType")(value)} />
            {label}
          </label>
        ))}
      </div>

      <div className="tw-route">
        <LocationCombobox
          id="transfer-pickupLocationId"
          label="Pickup location"
          placeholder="Airport, hotel or area"
          value={form.pickupLocationId}
          locations={locations}
          exclude={form.dropoffLocationId}
          onChange={set("pickupLocationId")}
          error={errors.pickupLocationId}
        />
        <button type="button" className="tw-swap" onClick={swap} aria-label="Swap pickup and drop-off" title="Swap pickup and drop-off">
          <FaArrowRightArrowLeft aria-hidden="true" />
        </button>
        <LocationCombobox
          id="transfer-dropoffLocationId"
          label="Drop-off location"
          placeholder="Airport, hotel or area"
          value={form.dropoffLocationId}
          locations={locations}
          exclude={form.pickupLocationId}
          onChange={set("dropoffLocationId")}
          error={errors.dropoffLocationId}
        />
      </div>

      <div className="tw-grid-2">
        <TextField id="transfer-travelDate" label="Travel date" icon={<FaCalendarDays />} type="date" min={today} max={lastDate || undefined} value={form.travelDate} onChange={(event) => set("travelDate")(event.target.value)} error={errors.travelDate} required />
        <TextField id="transfer-travelTime" label="Pickup time (Zanzibar time)" icon={<FaClock />} type="time" value={form.travelTime} onChange={(event) => set("travelTime")(event.target.value)} required help="East Africa Time (EAT, UTC+3)" />
      </div>
      {roundTrip ? (
        <div className="tw-return">
          <p className="tw-return-title">Return: {locations.find((location) => location.id === form.dropoffLocationId)?.name || "drop-off"} to {locations.find((location) => location.id === form.pickupLocationId)?.name || "pickup"}</p>
          <div className="tw-grid-2">
            <TextField id="transfer-returnDate" label="Return date" icon={<FaCalendarDays />} type="date" min={form.travelDate || today} max={lastDate || undefined} value={form.returnDate} onChange={(event) => set("returnDate")(event.target.value)} error={errors.returnDate} required />
            <TextField id="transfer-returnTime" label="Return pickup time (Zanzibar time)" icon={<FaClock />} type="time" value={form.returnTime} onChange={(event) => set("returnTime")(event.target.value)} required />
          </div>
        </div>
      ) : null}

      <fieldset className="tw-fieldset">
        <legend className="tw-section-label">Passengers and luggage</legend>
        <div className="tw-counters">
          <Counter id="transfer-adults" label="Adults" hint="12+ years" value={form.adults} min={1} onChange={set("adults")} invalid={errors.adults} />
          <Counter id="transfer-children" label="Children" hint="4–11 years" value={form.children} onChange={set("children")} invalid={errors.children} />
          <Counter id="transfer-infants" label="Infants" hint="0–3 years" value={form.infants} onChange={set("infants")} invalid={errors.infants} />
          <Counter id="transfer-largeBags" label="Large bags" hint="Suitcases" value={form.largeBags} max={40} onChange={set("largeBags")} invalid={errors.largeBags} />
          <Counter id="transfer-smallBags" label="Small bags" hint="Backpacks" value={form.smallBags} max={40} onChange={set("smallBags")} invalid={errors.smallBags} />
        </div>
        <p className="tw-help mb-0">Infants need their own seat in the vehicle, so they count towards its capacity.</p>
        <FieldError id="transfer-passengers-error">{errors.adults || errors.children || errors.infants || errors.largeBags || errors.smallBags}</FieldError>
      </fieldset>
    </>
  );
};

export const TripFacts = () => (
  <ul className="tw-facts">
    <li><FaVanShuttle aria-hidden="true" /><span><strong>Private vehicle</strong>Only your group travels</span></li>
    <li><FaTag aria-hidden="true" /><span><strong>Price per vehicle</strong>Not per person</span></li>
    <li><FaLink aria-hidden="true" /><span><strong>Booking reference</strong>With a private link to your booking</span></li>
  </ul>
);

// ---------- Step 2: Vehicle ----------
export const VehicleStep = ({ form, set, errors, quote, quoteState, onRetryQuote }) => {
  const group = `${passengerSummary(passengersOf(form))}, with ${bagsLabel(form)}`;
  if (quoteState === "loading" || quoteState === "idle") {
    return (
      <>
        <StepHeading title="Choose your vehicle" />
        <div className="tw-loading" role="status"><Spinner animation="border" size="sm" /> Finding vehicles and prices for your trip…</div>
      </>
    );
  }
  if (quoteState === "error" || !quote) {
    return (
      <>
        <StepHeading title="Choose your vehicle" />
        <Alert variant="warning" role="alert" className="d-flex flex-wrap gap-2 align-items-center justify-content-between">
          We could not check prices right now.
          <button type="button" className="tw-btn tw-btn-outline" onClick={onRetryQuote}>Try again</button>
        </Alert>
      </>
    );
  }
  if (quote.status !== "PRICED") {
    return (
      <>
        <StepHeading title="Request a Quote" subtitle={`For ${group}.`} />
        <div className="tw-quote-card">
          <FaCircleInfo aria-hidden="true" />
          <div>
            <h2>There is no set price for this trip yet</h2>
            <p>Send us your details and our team will price your trip. You will then receive a secure link to pay online. Your transfer is confirmed only after the payment has been verified.</p>
          </div>
        </div>
      </>
    );
  }
  const selected = form.vehicleOption === PRIVATE_VEHICLE;
  const roundTrip = quote.legs.length > 1;
  return (
    <>
      <StepHeading title="Choose your vehicle" subtitle={`Showing vehicles for ${group}. Prices are per vehicle.`} />
      <div className="tw-vehicles" role="radiogroup" aria-label="Vehicle" aria-describedby={errors.vehicleOption ? "transfer-vehicleOption-error" : undefined}>
        <article className={`tw-vehicle ${selected ? "is-selected" : ""}`}>
          {selected ? <span className="tw-vehicle-badge">Selected for your group</span> : null}
          <div className="tw-vehicle-media" aria-hidden="true"><FaVanShuttle /></div>
          <div className="tw-vehicle-info">
            <h2>Private vehicle</h2>
            <p>A private vehicle for your group only. Our team assigns a vehicle with a seat for every passenger.</p>
            <ul className="tw-vehicle-specs">
              <li><FaUser aria-hidden="true" /> {passengerSummary(passengersOf(form))}</li>
              <li><FaSuitcaseRolling aria-hidden="true" /> {bagsLabel(form)}</li>
            </ul>
          </div>
          <div className="tw-vehicle-price">
            <span className="tw-vehicle-amount">{formatUsd(quote.total)}</span>
            <span className="tw-summary-muted">per vehicle{roundTrip ? ", both ways" : ""}</span>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              id="transfer-vehicleOption"
              className={`tw-btn ${selected ? "tw-btn-teal" : "tw-btn-outline"}`}
              onClick={() => set("vehicleOption")(PRIVATE_VEHICLE)}
            >
              {selected ? "✓ Selected" : "Select"}
            </button>
          </div>
        </article>
      </div>
      <FieldError id="transfer-vehicleOption-error">{errors.vehicleOption}</FieldError>
    </>
  );
};

// ---------- Step 3: Details ----------
export const DetailsStep = ({ form, set, errors, fields }) => {
  const flight = fields.flight ? (
    <TextField
      id="transfer-flightNumber"
      label="Flight number"
      icon={<FaPlaneArrival />}
      optional
      maxLength={12}
      autoCapitalize="characters"
      placeholder="e.g. PW 724"
      value={form.flightNumber}
      onChange={(event) => set("flightNumber")(event.target.value)}
      error={errors.flightNumber}
      help={fields.flightFirst ? "Your arrival flight, as shown on your ticket." : "Your departure flight, as shown on your ticket."}
    />
  ) : null;
  return (
    <>
      <StepHeading title="Your details" subtitle="Please provide your contact details and any additional information for your transfer." />
      <div className="tw-grid-2">
        <TextField id="transfer-fullName" label="Full name" icon={<FaUser />} required autoComplete="name" maxLength={120} value={form.fullName} onChange={(event) => set("fullName")(event.target.value)} error={errors.fullName} />
        <TextField id="transfer-email" label="Email address" icon={<FaEnvelope />} required type="email" inputMode="email" autoComplete="email" maxLength={200} value={form.email} onChange={(event) => set("email")(event.target.value)} error={errors.email} />
        <PhoneField country={form.phoneCountry} national={form.phoneNational} onCountry={set("phoneCountry")} onNational={set("phoneNational")} error={errors.phone} />
        <div className="tw-field tw-check-field">
          <label className="tw-check" htmlFor="transfer-whatsapp">
            <input id="transfer-whatsapp" type="checkbox" checked={form.whatsapp} onChange={(event) => set("whatsapp")(event.target.checked)} />
            This number is on WhatsApp
          </label>
        </div>
      </div>

      {fields.flight || fields.pickupAddress || fields.dropoffAddress ? (
        <div className="tw-grid-2">
          {fields.flightFirst ? flight : null}
          {fields.pickupAddress ? (
            <TextField id="transfer-pickupAddress" label="Hotel name or exact pickup address" optional maxLength={300} placeholder="e.g. hotel name, street or landmark" value={form.pickupAddress} onChange={(event) => set("pickupAddress")(event.target.value)} />
          ) : null}
          {fields.dropoffAddress ? (
            <TextField id="transfer-dropoffAddress" label="Hotel name or exact drop-off address" optional maxLength={300} placeholder="e.g. hotel name, street or landmark" value={form.dropoffAddress} onChange={(event) => set("dropoffAddress")(event.target.value)} />
          ) : null}
          {fields.flightFirst ? null : flight}
        </div>
      ) : null}

      <div className="tw-field">
        <label htmlFor="transfer-luggageNotes" className="tw-label">Other luggage <span className="tw-optional">(optional)</span></label>
        <input id="transfer-luggageNotes" className="tw-input tw-input-plain" maxLength={300} placeholder="e.g. surfboard, pram, wheelchair" value={form.luggageNotes} onChange={(event) => set("luggageNotes")(event.target.value)} />
      </div>
      <div className="tw-field">
        <label htmlFor="transfer-specialRequests" className="tw-label">Special requests <span className="tw-optional">(optional)</span></label>
        <textarea id="transfer-specialRequests" className="tw-input tw-input-plain tw-textarea" rows={3} maxLength={1000} placeholder="e.g. child seat, name sign, extra stop" value={form.specialRequests} onChange={(event) => set("specialRequests")(event.target.value)} aria-describedby="transfer-specialRequests-help" />
        <div id="transfer-specialRequests-help" className="tw-help tw-help-split">
          <span>Tell us anything our team should know for your transfer.</span>
          <span>{form.specialRequests.length}/1000</span>
        </div>
      </div>

      {/* Honeypot: hidden from people and screen readers; bots that fill it are rejected. */}
      <div className="transfer-hp" aria-hidden="true">
        <label htmlFor="transfer-website">Website</label>
        <input id="transfer-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => set("website")(event.target.value)} />
      </div>
    </>
  );
};

// ---------- Step 4: Review & pay ----------
const ReviewSection = ({ title, icon, onEdit, children }) => (
  <section className="tw-review">
    <header>
      <h2>{icon}{title}</h2>
      <button type="button" className="tw-edit" onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`}><FaPen aria-hidden="true" /> Edit</button>
    </header>
    {children}
  </section>
);

const Row = ({ label, children }) => (children ? <div><dt>{label}</dt><dd>{children}</dd></div> : null);

export const ReviewStep = ({ form, locations, quote, quoteState, payment, goTo, fields }) => {
  const name = (id) => locations.find((location) => location.id === id)?.name || "";
  const roundTrip = form.tripType === TRIP_TYPES.ROUND_TRIP;
  const priced = quote?.status === "PRICED";
  return (
    <>
      <StepHeading
        title={priced ? "Review and pay" : "Review your request"}
        subtitle={priced ? "Please check your transfer details and pay securely online." : "Please check your details before sending your quote request."}
      />
      <ReviewSection title="Trip details" onEdit={() => goTo(0)}>
        <dl className="tw-review-rows">
          <Row label="Trip type">{roundTrip ? "Round trip" : "One-way"}</Row>
          <Row label="From">{name(form.pickupLocationId)}</Row>
          <Row label="To">{name(form.dropoffLocationId)}</Row>
          <Row label="Date & time">{`${formatTripDate(form.travelDate, form.travelTime)} (Zanzibar time)`}</Row>
          {roundTrip ? <Row label="Return">{`${formatTripDate(form.returnDate, form.returnTime)} (Zanzibar time)`}</Row> : null}
          <Row label="Passengers">{passengerSummary(passengersOf(form))}</Row>
          <Row label="Luggage">{bagsLabel(form)}{form.luggageNotes.trim() ? ` · ${form.luggageNotes.trim()}` : ""}</Row>
        </dl>
      </ReviewSection>

      <ReviewSection title="Vehicle" onEdit={() => goTo(1)}>
        {priced ? (
          <div className="tw-review-vehicle">
            <span className="tw-review-vehicle-icon" aria-hidden="true"><FaVanShuttle /></span>
            <div>
              <strong>Private vehicle</strong>
              <div className="tw-summary-muted">A seat for every passenger · {bagsLabel(form)}</div>
            </div>
            <span className="tw-review-vehicle-price">{formatUsd(quote.total)}<small>per vehicle</small></span>
          </div>
        ) : (
          <p className="mb-0">Price on request: our team will price a vehicle for your group.</p>
        )}
      </ReviewSection>

      <ReviewSection title="Your details" onEdit={() => goTo(2)}>
        <dl className="tw-review-rows">
          <Row label="Name">{form.fullName.trim()}</Row>
          <Row label="Email">{form.email.trim()}</Row>
          <Row label="Phone">{`${form.phone}${form.whatsapp ? " (WhatsApp)" : ""}`}</Row>
          {fields.flight ? <Row label="Flight">{form.flightNumber.trim().toUpperCase()}</Row> : null}
          {fields.pickupAddress ? <Row label="Pickup address">{form.pickupAddress.trim()}</Row> : null}
          {fields.dropoffAddress ? <Row label="Drop-off address">{form.dropoffAddress.trim()}</Row> : null}
          <Row label="Special requests">{form.specialRequests.trim()}</Row>
        </dl>
      </ReviewSection>

      <section className="tw-review tw-review-price" aria-live="polite">
        <h2 className="visually-hidden">Price</h2>
        <PriceLines quote={quote} quoteState={quoteState} />
      </section>

      <section className="tw-review">
        <header><h2><FaLock aria-hidden="true" />Payment</h2></header>
        {priced ? (
          <>
            <div className="tw-pay-method" role="radiogroup" aria-label="Payment method">
              <label className="tw-pay-option is-selected">
                <input type="radio" name="paymentMethod" value="PESAPAL" checked readOnly />
                <FaCreditCard aria-hidden="true" />
                <span><strong>Pay online with Pesapal</strong>Card or mobile money, where available</span>
              </label>
            </div>
            <p className="tw-help">You pay on Pesapal&apos;s secure page. Your transfer is confirmed only after Pesapal confirms the payment to us.</p>
            {payment?.onlineAvailable ? null : (
              <Alert variant="warning" className="mb-0" role="status">
                Online payment is not open yet, so this booking cannot be completed online at the moment. Nothing has been saved or charged.
              </Alert>
            )}
          </>
        ) : (
          <p className="mb-0">No payment now. When our team has priced your trip, you will receive a secure link to pay online with Pesapal. Your transfer is confirmed only after the payment has been verified.</p>
        )}
      </section>
    </>
  );
};
