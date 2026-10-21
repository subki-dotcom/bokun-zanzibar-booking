import { useEffect, useMemo, useRef, useState } from "react";
import { BsCalendar3, BsChevronLeft, BsChevronRight } from "react-icons/bs";
import { fetchTourAvailableDates } from "../../../../api/toursApi";
import { isSelectableDate, monthWeeks, parseIsoDate, toIsoDate } from "./availabilityCalendar";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MAX_MONTHS_AHEAD = 12;

const formatButtonDate = (iso) => {
  const date = parseIsoDate(iso);
  return date ? date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "";
};

// Calendar that greys out dates without a bookable start time (from Bókun availability). When availability cannot be
// loaded every future date stays selectable, and the date is checked when the guest presses "Check availability".
const DateAvailabilityPicker = ({ value = "", disabled = false, onChange, slug = "" }) => {
  const today = useMemo(() => toIsoDate(new Date()), []);
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState(() => {
    const base = parseIsoDate(value) || new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!slug) return undefined;
    let active = true;
    setLoading(true);
    fetchTourAvailableDates(slug, { from: today, days: 90 })
      .then((result) => {
        if (!active || !result) return;
        setAvailability({ startDate: result.startDate, endDate: result.endDate, dates: new Set(result.availableDates || []) });
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug, today]);

  // Open on the first month with a bookable date when nothing is chosen yet.
  useEffect(() => {
    if (value || !availability?.dates.size) return;
    const first = parseIsoDate([...availability.dates].sort()[0]);
    if (first) setMonth(new Date(first.getFullYear(), first.getMonth(), 1));
  }, [availability, value]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const lastMonth = new Date(thisMonth.getFullYear(), thisMonth.getMonth() + MAX_MONTHS_AHEAD, 1);
  const canGoBack = month > thisMonth;
  const canGoForward = month < lastMonth;
  const weeks = monthWeeks(month);
  const monthLabel = month.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const pick = (iso) => {
    onChange?.(iso);
    setOpen(false);
  };

  return (
    <div className="tour-calendar" ref={wrapRef}>
      <div className="single-booking-inline-label">Travel date</div>
      <button
        type="button"
        className="tour-calendar-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={value ? `Travel date ${formatButtonDate(value)}, change date` : "Select date"}
        onClick={() => setOpen((current) => !current)}
      >
        <BsCalendar3 aria-hidden="true" />
        <span>{value ? formatButtonDate(value) : "Select a date"}</span>
      </button>

      {open ? (
        <div className="tour-calendar-panel" role="dialog" aria-label="Choose a travel date">
          <div className="tour-calendar-head">
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} disabled={!canGoBack} aria-label="Previous month">
              <BsChevronLeft aria-hidden="true" />
            </button>
            <strong>{monthLabel}</strong>
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} disabled={!canGoForward} aria-label="Next month">
              <BsChevronRight aria-hidden="true" />
            </button>
          </div>
          <table className="tour-calendar-grid">
            <thead>
              <tr>{WEEKDAYS.map((day) => <th key={day} scope="col">{day}</th>)}</tr>
            </thead>
            <tbody>
              {weeks.map((week, index) => (
                <tr key={index}>
                  {week.map((iso, column) => {
                    if (!iso) return <td key={`empty-${column}`} />;
                    const selectable = isSelectableDate(iso, { today, availability });
                    const selected = iso === value;
                    return (
                      <td key={iso}>
                        <button
                          type="button"
                          className={[selected ? "is-selected" : "", selectable ? "" : "is-unavailable"].filter(Boolean).join(" ")}
                          disabled={!selectable}
                          aria-pressed={selected}
                          aria-label={`${formatButtonDate(iso)}${selectable ? "" : ", not available"}`}
                          onClick={() => pick(iso)}
                        >
                          {Number(iso.slice(8, 10))}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tour-calendar-note" role="status">
            {loading ? "Loading available dates…" : availability ? "Greyed-out dates are not available." : "Pick a date to check live availability."}
          </p>
        </div>
      ) : null}
    </div>
  );
};

export default DateAvailabilityPicker;
