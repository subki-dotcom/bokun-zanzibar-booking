import { useRef, useState } from "react";
import { LuCalendarClock, LuUserPlus } from "react-icons/lu";
import { newIdempotencyKey, submitMyBookingRequest } from "../../api/myBookingApi";
import { trackAnalyticsEvent } from "../../utils/analytics";
import Dialog from "./Dialog";

// Tomorrow in Zanzibar ("YYYY-MM-DD"), the earliest new date.
const zanzibarTomorrow = () => new Date(Date.now() + 3 * 3600 * 1000 + 86400000).toISOString().slice(0, 10);

const Counter = ({ label, hint, value, min = 0, onChange }) => (
  <div className="mb-counter">
    <div>
      <strong>{label}</strong>
      <small>{hint}</small>
    </div>
    <div className="mb-counter-controls">
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`}>−</button>
      <output aria-live="polite" aria-label={label}>{value}</output>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= 20} aria-label={`More ${label.toLowerCase()}`}>+</button>
    </div>
  </div>
);

// "Change date or time" and "Change travelers": a request our team reviews (availability and price difference).
const ChangeDialog = ({ type, data, onClose, onDone }) => {
  const reschedule = type === "reschedule";
  const [date, setDate] = useState(data.date || "");
  const [time, setTime] = useState(data.startTime || "");
  const [travelers, setTravelers] = useState({ ...data.travelers });
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey] = useState(newIdempotencyKey);
  const first = useRef(null);

  const unchanged = reschedule
    ? date === data.date && time === data.startTime
    : ["adults", "children", "infants"].every((key) => Number(travelers[key] || 0) === Number(data.travelers[key] || 0));

  const submit = async (event) => {
    event.preventDefault();
    if (unchanged) {
      setError(reschedule ? "Choose a different date or time." : "Change the number of travelers first.");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Tell us briefly why you'd like the change.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await submitMyBookingRequest(
        data.reference,
        {
          type,
          requestedChanges: reschedule ? { date, ...(time ? { startTime: time } : {}) } : { travelers },
          customerReason: reason.trim()
        },
        idempotencyKey
      );
      trackAnalyticsEvent("change_request");
      onDone("Change requested – we've emailed you a confirmation");
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <Dialog onClose={onClose} labelledBy="mb-change-title" initialFocus={first} busy={submitting}>
      <span className="mb-dialog-icon is-brand" aria-hidden="true">{reschedule ? <LuCalendarClock size={24} /> : <LuUserPlus size={24} />}</span>
      <h2 id="mb-change-title">{reschedule ? "Change date or time" : "Change travelers"}</h2>
      <p className="mb-dialog-lead">
        {reschedule
          ? "Pick a new date. Our team checks availability with the operator and confirms by email – usually within 24 hours."
          : "Add or remove people. We'll email you any price difference before anything changes."}
      </p>
      <form onSubmit={submit} noValidate>
        {reschedule ? (
          <>
            <div className="mb-field">
              <label htmlFor="mb-change-date">New date</label>
              <input ref={first} id="mb-change-date" type="date" className="mb-input" value={date} min={zanzibarTomorrow()} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="mb-field">
              <label htmlFor="mb-change-time">Preferred time (Zanzibar time)</label>
              <input id="mb-change-time" type="time" className="mb-input" value={time} onChange={(event) => setTime(event.target.value)} />
            </div>
          </>
        ) : (
          <div className="mb-field">
            <Counter label="Adults" hint="Age 18+" value={Number(travelers.adults || 0)} min={1} onChange={(value) => setTravelers((current) => ({ ...current, adults: value }))} />
            <Counter label="Children" hint="Age 3–17" value={Number(travelers.children || 0)} onChange={(value) => setTravelers((current) => ({ ...current, children: value }))} />
            <Counter label="Infants" hint="Under 3" value={Number(travelers.infants || 0)} onChange={(value) => setTravelers((current) => ({ ...current, infants: value }))} />
          </div>
        )}
        <div className="mb-field">
          <label htmlFor="mb-change-reason">{reschedule ? "Why the new date?" : "Anything we should know?"}</label>
          <textarea
            ref={reschedule ? undefined : first}
            id="mb-change-reason"
            className="mb-input"
            value={reason}
            maxLength={1500}
            onChange={(event) => setReason(event.target.value)}
            placeholder={reschedule ? "e.g. Our flight moved to a day later" : "e.g. A friend is joining us"}
          />
        </div>
        {error ? <p className="mb-alert" role="alert">{error}</p> : null}
        <div className="mb-dialog-actions">
          <button type="button" className="mb-btn mb-btn-outline" onClick={onClose} disabled={submitting}>
            Keep my booking
          </button>
          <button type="submit" className="mb-btn mb-btn-primary" disabled={submitting}>
            {submitting ? "Sending…" : "Send request"}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

export default ChangeDialog;
