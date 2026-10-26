import { useRef, useState } from "react";
import { LuLock } from "react-icons/lu";
import { revealContact, sendContactCode } from "../../api/myBookingApi";
import { SITE, whatsappLink } from "../../config/site";
import Dialog from "./Dialog";

// Full traveler details only after a 6-digit code sent to the booking email (masked everywhere else).
const ContactDetailsDialog = ({ data, onClose }) => {
  const [step, setStep] = useState("start");
  const [code, setCode] = useState("");
  const [details, setDetails] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const first = useRef(null);

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      await sendContactCode(data.reference);
      setStep("code");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const check = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setDetails(await revealContact(data.reference, code.trim()));
      setStep("details");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const changeHref = whatsappLink(`Hi, I'd like to update the traveler details of booking ${data.reference}: `);

  return (
    <Dialog onClose={onClose} labelledBy="mb-contact-title" initialFocus={first} busy={busy}>
      <span className="mb-dialog-icon is-brand" aria-hidden="true"><LuLock size={22} /></span>
      <h2 id="mb-contact-title">Traveler details</h2>
      {step === "start" ? (
        <>
          <p className="mb-dialog-lead">
            To keep your details private we show them masked. We&apos;ll email a 6-digit code to <strong>{data.signedInAs}</strong> to show them in full.
          </p>
          {error ? <p className="mb-alert" role="alert">{error}</p> : null}
          <div className="mb-dialog-actions">
            <button type="button" className="mb-btn mb-btn-outline" onClick={onClose}>Close</button>
            <button ref={first} type="button" className="mb-btn mb-btn-primary" onClick={send} disabled={busy}>
              {busy ? "Sending…" : "Email me a code"}
            </button>
          </div>
        </>
      ) : null}
      {step === "code" ? (
        <form onSubmit={check} noValidate>
          <p className="mb-dialog-lead">Enter the code we sent to {data.signedInAs}. It expires in 10 minutes.</p>
          <div className="mb-field">
            <label htmlFor="mb-contact-code">6-digit code</label>
            <input
              autoFocus
              id="mb-contact-code"
              className="mb-input mb-code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            />
          </div>
          {error ? <p className="mb-alert" role="alert">{error}</p> : null}
          <div className="mb-dialog-actions">
            <button type="button" className="mb-btn mb-btn-outline" onClick={send} disabled={busy}>Send a new code</button>
            <button type="submit" className="mb-btn mb-btn-primary" disabled={busy || code.length !== 6}>
              {busy ? "Checking…" : "Show details"}
            </button>
          </div>
        </form>
      ) : null}
      {step === "details" && details ? (
        <>
          <dl className="mb-contact-list">
            <div><dt>Lead traveler</dt><dd>{`${details.firstName} ${details.lastName}`.trim() || "—"}</dd></div>
            <div><dt>Email</dt><dd>{details.email || "—"}</dd></div>
            <div><dt>Phone</dt><dd>{details.phone || "—"}</dd></div>
            <div><dt>Country</dt><dd>{details.country || "—"}</dd></div>
            <div><dt>Hotel</dt><dd>{details.hotelName || "—"}</dd></div>
          </dl>
          <p className="mb-dialog-alt">
            Something wrong?{" "}
            {changeHref ? <a href={changeHref} target="_blank" rel="noreferrer">Message us on WhatsApp</a> : <a href={`mailto:${SITE.email}`}>Email us</a>} and we&apos;ll update it.
          </p>
          <div className="mb-dialog-actions">
            {/* Focus follows the new step. */}
            <button autoFocus type="button" className="mb-btn mb-btn-primary" onClick={onClose}>Done</button>
          </div>
        </>
      ) : null}
    </Dialog>
  );
};

export default ContactDetailsDialog;
