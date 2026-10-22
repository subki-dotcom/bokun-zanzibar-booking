import { useEffect, useMemo, useRef, useState } from "react";
import { LuCalendar, LuCheck, LuChevronLeft, LuChevronRight, LuMessageCircle, LuMinus, LuPlus } from "react-icons/lu";
import { formatCurrency } from "../../../utils/formatters";
import { BRAND } from "../../../config/brand";
import { isSelectableDate, monthWeeks, parseIsoDate, toIsoDate } from "../single/bookingCard/availabilityCalendar";
import { freeCancellationWindow } from "./tourSectionsData";
import { ageLabel, travellersLabel } from "./bookingHelpers";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export const formatShortDate = (iso = "") => {
  const date = parseIsoDate(iso);
  return date ? date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "";
};

export const TravelersStepper = ({ categories = [], counts = {}, onChange, disabled = false }) => (
  <div className="tp-travelers" role="group" aria-label="Travelers">
    {categories.map((category) => {
      const value = Math.max(0, Number(counts[category.id] || 0));
      const age = ageLabel(category);
      return (
        <div key={category.id} className="tp-traveler-row">
          <span>
            <strong>{category.label === "Adult" ? "Adults" : category.label === "Child" ? "Children" : category.label}</strong>
            {age ? <small>{age}</small> : null}
          </span>
          <span className="tp-stepper">
            <button type="button" disabled={disabled || value <= category.min} onClick={() => onChange(category.id, value - 1)} aria-label={`Fewer ${category.label.toLowerCase()} travelers`}>
              <LuMinus aria-hidden="true" />
            </button>
            <output aria-live="polite" aria-label={`${category.label}: ${value}`}>{value}</output>
            <button type="button" disabled={disabled || value >= category.max} onClick={() => onChange(category.id, value + 1)} aria-label={`More ${category.label.toLowerCase()} travelers`}>
              <LuPlus aria-hidden="true" />
            </button>
          </span>
        </div>
      );
    })}
  </div>
);

// Month grids (Sunday first); unavailable dates are disabled and struck through.
export const AvailabilityCalendar = ({ value = "", availability = null, months = 1, onPick }) => {
  const today = useMemo(() => toIsoDate(new Date()), []);
  const firstMonth = useMemo(() => {
    const base = parseIsoDate(value) || (availability?.dates?.size ? parseIsoDate([...availability.dates].sort()[0]) : null) || new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  }, [value, availability]);
  const [start, setStart] = useState(firstMonth);
  useEffect(() => setStart(firstMonth), [firstMonth]);
  const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const shown = Array.from({ length: months }, (_, index) => new Date(start.getFullYear(), start.getMonth() + index, 1));

  return (
    <div className="tp-calendar">
      <div className="tp-calendar-nav">
        <button type="button" onClick={() => setStart(new Date(start.getFullYear(), start.getMonth() - 1, 1))} disabled={start <= thisMonth} aria-label="Previous month"><LuChevronLeft aria-hidden="true" /></button>
        <button type="button" onClick={() => setStart(new Date(start.getFullYear(), start.getMonth() + 1, 1))} aria-label="Next month"><LuChevronRight aria-hidden="true" /></button>
      </div>
      <div className="tp-calendar-months">
        {shown.map((month) => (
          <div key={month.toISOString()} className="tp-calendar-month">
            <strong>{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</strong>
            <table>
              <thead><tr>{WEEKDAYS.map((day) => <th key={day} scope="col">{day}</th>)}</tr></thead>
              <tbody>
                {monthWeeks(month, 0).map((week, row) => (
                  <tr key={row}>
                    {week.map((iso, column) => {
                      if (!iso) return <td key={`e${column}`} />;
                      const selectable = isSelectableDate(iso, { today, availability });
                      return (
                        <td key={iso}>
                          <button
                            type="button"
                            className={[iso === value ? "is-selected" : "", selectable ? "" : "is-unavailable"].filter(Boolean).join(" ")}
                            disabled={!selectable}
                            aria-pressed={iso === value}
                            aria-label={`${parseIsoDate(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}${selectable ? "" : ", not available"}`}
                            onClick={() => onPick(iso)}
                          >
                            {Number(iso.slice(8))}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
};

// Date button that opens a two-month calendar.
export const DateField = ({ value = "", availability = null, onPick }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const label = value ? parseIsoDate(value).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "Select a date";
  return (
    <div className="tp-date-field" ref={wrapRef}>
      <button type="button" className="tp-date-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <LuCalendar aria-hidden="true" />
        <span>{label}</span>
      </button>
      {open ? (
        <div className="tp-date-popover" role="dialog" aria-label="Choose a date">
          <AvailabilityCalendar value={value} availability={availability} months={2} onPick={(iso) => { onPick(iso); setOpen(false); }} />
          <p className="tp-calendar-note">{availability ? "Dates without a departure are crossed out." : "Loading available dates…"}</p>
        </div>
      ) : null}
    </div>
  );
};

export const TimePills = ({ slots = [], selectedKey = "", slotKey, onPick, label = "Start time" }) => (
  <div className="tp-times" role="radiogroup" aria-label={label}>
    {slots.map((slot) => {
      const key = slotKey(slot);
      const selected = key === selectedKey;
      return (
        <button key={key} type="button" role="radio" aria-checked={selected} className={selected ? "is-selected" : ""} onClick={() => onPick(slot)}>
          {slot.time}
        </button>
      );
    })}
  </div>
);

const perPerson = (option, travellerCount) =>
  option.pricingType === "per_group" || !travellerCount ? null : option.total / travellerCount;

export const OptionCard = ({ option, selected, badge = "", travellerCount = 1, selectedSlotKey = "", slotKey, onSelect, onPickSlot }) => {
  const each = perPerson(option, travellerCount);
  const total = option.total ? formatCurrency(option.total, option.currency) : "";
  if (!selected) {
    return (
      <button type="button" className="tp-option" onClick={() => onSelect(option.id)} aria-label={`${option.name}, ${total || "price at checkout"}`}>
        <span className="tp-option-head">
          <strong>{option.name}</strong>
          <b>{total}</b>
        </span>
        {each ? <small>{formatCurrency(each, option.currency)} per person</small> : option.pricingType === "per_group" ? <small>Price for your group</small> : null}
      </button>
    );
  }
  return (
    <div className="tp-option is-selected" aria-current="true">
      <div className="tp-option-head">
        <strong>{option.name}</strong>
        {badge ? <span className="tp-option-badge">{badge}</span> : null}
      </div>
      {option.description ? <p className="tp-option-desc">{option.description}</p> : null}
      <TimePills slots={option.slots} selectedKey={selectedSlotKey} slotKey={slotKey} onPick={(slot) => onPickSlot(option.id, slot)} label={`Start time for ${option.name}`} />
      <div className="tp-option-total">
        <span>{each ? `${travellerCount} traveler${travellerCount === 1 ? "" : "s"} × ${formatCurrency(each, option.currency)}` : "Total for your group"}</span>
        <b>{total}</b>
      </div>
    </div>
  );
};

export const TrustList = ({ cancellationSummary = "", compact = false }) => {
  const window = freeCancellationWindow(cancellationSummary);
  return (
    <ul className={`tp-trust ${compact ? "is-compact" : ""}`.trim()}>
      {window ? <li><LuCheck aria-hidden="true" /> <span><b>Free cancellation</b> up to {window} before</span></li> : null}
      {compact ? null : <li><LuCheck aria-hidden="true" /> <span><b>Email confirmation</b> after payment</span></li>}
      {compact ? null : <li><LuCheck aria-hidden="true" /> <span><b>Secure payment</b> · PayPal, Pesapal, DPO, cards</span></li>}
    </ul>
  );
};

export const whatsappHref = (tourTitle = "", travelDate = "") => {
  if (!BRAND.whatsappHref) return "";
  const when = travelDate ? ` on ${formatShortDate(travelDate)}` : "";
  return `${BRAND.whatsappHref}?text=${encodeURIComponent(`Hello, I have a question about "${tourTitle}"${when}.`)}`;
};

export const WhatsAppButton = ({ tourTitle = "", travelDate = "" }) => {
  const href = whatsappHref(tourTitle, travelDate);
  if (!href) return null;
  return (
    <a className="tp-whatsapp-btn" href={href} target="_blank" rel="noopener noreferrer">
      <LuMessageCircle aria-hidden="true" /> Questions? Chat on WhatsApp
    </a>
  );
};

// Options for the chosen date, the Book now button and its summary (used by the card and the mobile sheet).
export const OptionsAndBook = ({ booking, compactTrust = false }) => {
  const { options, selectedOption, selectedSlot, travelDate, quotesLoading, quotesError, hasQuotes, travellerCount, pax, lowestOptionId } = booking;
  const selectedKey = selectedSlot ? booking.slotKey(selectedSlot) : "";
  return (
    <>
      <div className="tp-field-label">Choose an option</div>
      {!travelDate ? <p className="tp-hint">Pick a date to see options, times and prices.</p> : null}
      {travelDate && quotesLoading ? (
        <div className="tp-options" aria-busy="true">
          <div className="tp-skeleton tp-skeleton-option" />
          <div className="tp-skeleton tp-skeleton-option is-short" />
          <span className="tp-visually-hidden" role="status">Loading prices for this date…</span>
        </div>
      ) : null}
      {travelDate && !quotesLoading && quotesError ? <p className="tp-hint is-error" role="alert">{quotesError}</p> : null}
      {travelDate && !quotesLoading && hasQuotes && !options.length ? <p className="tp-hint" role="status">No departures on this date. Please choose another date.</p> : null}
      {travelDate && !quotesLoading && options.length ? (
        <div className="tp-options">
          {options.map((option) => (
            <OptionCard
              key={option.id}
              option={option}
              selected={option.id === selectedOption?.id}
              badge={options.length > 1 && option.id === lowestOptionId ? "Lowest price" : ""}
              travellerCount={travellerCount}
              selectedSlotKey={selectedKey}
              slotKey={booking.slotKey}
              onSelect={booking.chooseOption}
              onPickSlot={booking.chooseSlot}
            />
          ))}
        </div>
      ) : null}
      <button type="button" className="tp-book-btn" disabled={!booking.canBook} onClick={booking.book}>
        {booking.canBook ? `Book now · ${formatCurrency(selectedOption.total, selectedOption.currency)}` : "Book now"}
      </button>
      <p className="tp-book-summary">
        {booking.canBook ? [formatShortDate(travelDate), selectedSlot.time, travellersLabel(pax)].join(" · ") : travelDate ? "Choose an option and start time" : "Choose your date to continue"}
      </p>
      <TrustList cancellationSummary={booking.cancellationSummary} compact={compactTrust} />
    </>
  );
};

// Desktop booking card (sticky aside).
export const BookingCard = ({ tour = {}, booking }) => (
  <>
    <div className="tp-booking">
      <div className="tp-from">
        <small>From</small>
        {booking.startingPrice ? (
          <p><b>{formatCurrency(booking.startingPrice.amount, booking.startingPrice.currency)}</b> {booking.startingPrice.label}</p>
        ) : (
          <div className="tp-skeleton tp-skeleton-price" aria-label="Loading price" />
        )}
      </div>
      <div className="tp-field-label">Travelers</div>
      <TravelersStepper categories={booking.categories} counts={booking.counts} onChange={booking.setCount} disabled={!booking.ready} />
      <div className="tp-field-label">Date</div>
      <DateField value={booking.travelDate} availability={booking.availability} onPick={booking.chooseDate} />
      <OptionsAndBook booking={booking} />
    </div>
    <WhatsAppButton tourTitle={tour.title} travelDate={booking.travelDate} />
  </>
);
