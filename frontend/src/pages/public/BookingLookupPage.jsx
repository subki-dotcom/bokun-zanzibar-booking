import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { LuCheck, LuLock, LuMailCheck } from "react-icons/lu";
import { requestBookingLink } from "../../api/myBookingApi";
import Turnstile, { turnstileEnabled } from "../../components/myBooking/Turnstile";
import useBookingSession from "../../components/myBooking/useBookingSession";
import { whatsappLink } from "../../config/site";
import "../../components/myBooking/myBooking.css";

const RESEND_SECONDS = 60;
const CAPTCHA_FAILED = "The security check couldn't load. Please reload the page – if it keeps happening, ask us on WhatsApp.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// After the form: the same message whether or not the details matched.
export const MagicLinkSent = ({ email, onResend, onChangeEmail, resending, error, check = null }) => {
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const heading = useRef(null);
  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    if (seconds <= 0) return undefined;
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  return (
    <div className="mb-sent">
      <span className="mb-sent-icon" aria-hidden="true">
        <LuMailCheck size={30} />
      </span>
      <h2 ref={heading} tabIndex={-1}>Check your email</h2>
      <p>
        If the details match, we&apos;ve sent a link to <strong>{email}</strong>. It works once and expires in 30 minutes.
      </p>
      {/* The bot check again: each link request needs a fresh token. */}
      {check}
      {error ? <p className="mb-alert" role="alert">{error}</p> : null}
      <div className="mb-sent-actions">
        <button
          type="button"
          className="mb-btn mb-btn-primary mb-btn-block"
          disabled={seconds > 0 || resending}
          onClick={async () => {
            if (await onResend()) setSeconds(RESEND_SECONDS);
          }}
        >
          {resending ? "Sending…" : seconds > 0 ? `Resend link in ${seconds}s` : "Resend link"}
        </button>
        <button type="button" className="mb-btn mb-btn-outline mb-btn-block" onClick={onChangeEmail}>
          Use a different email
        </button>
      </div>
      <p className="mb-sent-note">No email after a few minutes? Check your spam folder or ask us on WhatsApp.</p>
    </div>
  );
};

// /my-booking (mockup "MyBookingLookup"): reference + booking email → a one-time sign-in link by email.
const BookingLookupPage = () => {
  const [params] = useSearchParams();
  const session = useBookingSession();
  const [reference, setReference] = useState(() => String(params.get("ref") || "").toUpperCase());
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);
  const [captchaError, setCaptchaError] = useState("");
  const expired = params.get("expired") === "1";
  const wanted = String(params.get("ref") || "").toUpperCase();

  const send = async () => {
    setFormError("");
    if (turnstileEnabled && !captchaToken) {
      setFormError(captchaError ? CAPTCHA_FAILED : "Please wait a moment for the security check to finish, then try again.");
      return false;
    }
    setSubmitting(true);
    try {
      await requestBookingLink({ reference: reference.trim(), email: email.trim(), captchaToken: captchaToken || undefined });
      setSent(true);
      return true;
    } catch (error) {
      setFormError(error.message);
      return false;
    } finally {
      setSubmitting(false);
      // A Turnstile token works once.
      setCaptchaToken("");
      setCaptchaReset((value) => value + 1);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    const next = {};
    if (!reference.trim()) next.reference = "Enter your booking reference.";
    if (!EMAIL_PATTERN.test(email.trim())) next.email = "Enter the email address you booked with.";
    setErrors(next);
    if (Object.keys(next).length) return;
    await send();
  };

  // Already signed in to this booking on this device (or no specific booking asked for): go straight to it.
  if (session.status === "signed_in" && !sent && (!wanted || wanted === session.reference) && !expired) {
    return <Navigate to={`/my-booking/${encodeURIComponent(session.reference)}`} replace />;
  }

  const check = (
    <Turnstile
      onToken={setCaptchaToken}
      onError={(code) => {
        setCaptchaError(code);
        if (code) setFormError(CAPTCHA_FAILED);
      }}
      resetSignal={captchaReset}
    />
  );

  const helpHref = whatsappLink("Hi, I've lost my booking reference. My name and travel date are: ");

  return (
    <div className="mb">
      <div className="mb-container mb-lookup">
        <section className="mb-lookup-intro" aria-labelledby="mb-lookup-title">
          <span className="mb-eyebrow">My booking</span>
          <h1 id="mb-lookup-title">Find your booking</h1>
          <p>View your trip details, download your ticket and invoice, or request a change.</p>
          <ul className="mb-checks">
            <li><LuCheck aria-hidden="true" /> Your reference starts with ZNZ- and is in your confirmation email</li>
            <li><LuCheck aria-hidden="true" /> We send a secure one-time link to your booking email</li>
            <li><LuCheck aria-hidden="true" /> Your personal details stay private</li>
          </ul>
        </section>

        <div className="mb-lookup-card">
          {sent ? (
            <MagicLinkSent
              email={email.trim()}
              resending={submitting}
              check={check}
              error={formError}
              onResend={send}
              onChangeEmail={() => {
                setSent(false);
                setEmail("");
                setFormError("");
              }}
            />
          ) : (
            <form onSubmit={submit} noValidate>
              {expired ? (
                <p className="mb-alert" role="alert">That link has expired or was already used. Ask for a new one below.</p>
              ) : null}
              <div className="mb-field">
                <label htmlFor="mb-reference">Booking reference</label>
                <input
                  id="mb-reference"
                  className="mb-input"
                  value={reference}
                  onChange={(event) => setReference(event.target.value.toUpperCase())}
                  placeholder="ZNZ-…"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-invalid={errors.reference ? "true" : undefined}
                  aria-describedby={errors.reference ? "mb-reference-error" : undefined}
                />
                {errors.reference ? <p className="mb-field-error" id="mb-reference-error">{errors.reference}</p> : null}
              </div>
              <div className="mb-field">
                <label htmlFor="mb-email">Email used for the booking</label>
                <input
                  id="mb-email"
                  className="mb-input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  inputMode="email"
                  aria-invalid={errors.email ? "true" : undefined}
                  aria-describedby={errors.email ? "mb-email-error" : undefined}
                />
                {errors.email ? <p className="mb-field-error" id="mb-email-error">{errors.email}</p> : null}
              </div>
              {check}
              {formError ? <p className="mb-alert" role="alert">{formError}</p> : null}
              <button type="submit" className="mb-btn mb-btn-primary mb-btn-block mb-submit" disabled={submitting}>
                {submitting ? "Sending…" : "Send me a secure link"}
              </button>
              <p className="mb-info">
                <LuLock aria-hidden="true" size={18} />
                <span>Opening the link on this device keeps you signed in to your booking for 30 days.</span>
              </p>
              {helpHref ? (
                <p className="mb-lookup-help">
                  Lost your reference? <a href={helpHref} target="_blank" rel="noreferrer">Ask us on WhatsApp</a>
                </p>
              ) : null}
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookingLookupPage;
