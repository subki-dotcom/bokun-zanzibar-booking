import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LuClock, LuMail, LuMapPin, LuMessageCircle, LuPhone, LuRefreshCw } from "react-icons/lu";
import SeoHead from "../../components/common/SeoHead";
import { sendContactMessage } from "../../api/marketingApi";
import { SITE, whatsappLink } from "../../config/site";
import { SITE_PAGES } from "../../config/sitePages";
import "./contactPage.css";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMPTY = { name: "", email: "", phone: "", travelDate: "", message: "", website: "" };
const MAP_HREF = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${SITE.address.locality}, ${SITE.address.country}`)}`;
// The visitor waits at most this long before the "not sent" panel offers WhatsApp and email instead.
const SEND_TIMEOUT_MS = 20000;
const PHONE_LAYOUT = "(max-width: 699.98px)";

const errorsFor = (form) => {
  const errors = {};
  if (!form.name.trim()) errors.name = "Please enter your name.";
  if (!EMAIL_PATTERN.test(form.email.trim())) errors.email = "Please enter a valid email address.";
  if (form.message.trim().length < 5) errors.message = "Please tell us a little about your trip.";
  return errors;
};

// "2026-12-10" → "10 Dec 2026"
const travelDateLabel = (value = "") => {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], 12)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { timeout: true })), ms))
  ]);

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Large round icons of the result panels: a check that draws itself, or an X.
const ResultIcon = ({ kind }) => (
  <span className={`cp-result-icon is-${kind}`} aria-hidden="true">
    <span className="cp-result-dot">
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        {kind === "sent" ? <path className="cp-check" d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M7 7l10 10M17 7L7 17" />}
      </svg>
    </span>
  </span>
);

// /contact: WhatsApp, phone, email, address, hours and a short message form (sent to the team's inbox).
// The form card is a small state machine: idle → sending → sent | error (mockups "Contact form" 1–3).
const ContactPage = () => {
  const page = SITE_PAGES.contact;
  const ids = { name: useId(), email: useId(), phone: useId(), date: useId(), message: useId(), status: useId() };
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState("");
  const [phase, setPhase] = useState("idle");
  const [progress, setProgress] = useState("off");
  const [errorKind, setErrorKind] = useState("");
  const [lockedHeight, setLockedHeight] = useState(0);
  const card = useRef(null);
  const heading = useRef(null);
  const submitButton = useRef(null);
  const inFlight = useRef(false);
  const focusSubmit = useRef(false);
  const whatsapp = whatsappLink(SITE.whatsappHelloMessage);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  // A result panel: heading focused, and on phones the card scrolled into view below the sticky header.
  useEffect(() => {
    if (phase === "sent" || phase === "error") {
      heading.current?.focus({ preventScroll: true });
      if (window.matchMedia?.(PHONE_LAYOUT).matches) {
        card.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      }
    }
    if (phase === "idle" && focusSubmit.current) {
      focusSubmit.current = false;
      submitButton.current?.focus();
    }
  }, [phase]);

  const finish = (next) => {
    setProgress("done");
    setTimeout(() => setProgress("off"), 400);
    // Side by side with "Reach us", the panel takes the place of the form without the card jumping in size.
    // On phones the card fits the panel (no empty space under it).
    setLockedHeight(window.matchMedia?.(PHONE_LAYOUT).matches ? 0 : card.current?.offsetHeight || 0);
    setPhase(next);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (inFlight.current) return;
    const found = errorsFor(form);
    setErrors(found);
    if (Object.keys(found).length) {
      setStatus("Please check the highlighted fields.");
      return;
    }
    inFlight.current = true;
    setStatus("");
    setErrorKind("");
    setPhase("sending");
    setProgress("start");
    requestAnimationFrame(() => requestAnimationFrame(() => setProgress("running")));
    try {
      await withTimeout(sendContactMessage({ ...form, name: form.name.trim(), email: form.email.trim() }), SEND_TIMEOUT_MS);
      finish("sent");
    } catch (error) {
      setErrorKind(error?.status === 429 ? "rate" : "general");
      finish("error");
    } finally {
      inFlight.current = false;
    }
  };

  const sendAnother = () => {
    setForm(EMPTY);
    setErrors({});
    setLockedHeight(0);
    setPhase("idle");
  };

  // "Try again": the form comes back exactly as the visitor left it, ready to send.
  const tryAgain = () => {
    setLockedHeight(0);
    focusSubmit.current = true;
    setPhase("idle");
  };

  const sending = phase === "sending";
  const field = (key) => ({
    value: form[key],
    onChange: set(key),
    readOnly: sending,
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `${ids[key === "travelDate" ? "date" : key]}-error` : undefined
  });

  const firstName = form.name.trim().split(/\s+/)[0] || "";
  const visitorWhatsapp = whatsappLink(`Hi ${SITE.name}, ${form.message.trim()}`.slice(0, 1500)) || whatsapp;
  const emailHref = `mailto:${SITE.email}?subject=${encodeURIComponent(`Website enquiry from ${form.name.trim() || "the website"}`)}&body=${encodeURIComponent(form.message.trim())}`;

  return (
    <div className="cp">
      <SeoHead title={`${page.title} | ${SITE.name}`} description={page.description} />
      <div className="cp-container">
        <header className="cp-head">
          <h1>{page.title}</h1>
          <p>{page.intro} WhatsApp is the quickest way to reach us.</p>
        </header>

        <div className="cp-grid">
          <section className="cp-card" aria-labelledby="cp-reach">
            <h2 id="cp-reach">Reach us</h2>
            {whatsapp ? (
              <a href={whatsapp} className="cp-btn cp-btn-whatsapp" target="_blank" rel="noreferrer">
                <LuMessageCircle aria-hidden="true" /> Chat on WhatsApp
              </a>
            ) : null}
            <ul className="cp-list">
              <li>
                <LuPhone aria-hidden="true" />
                <span>Phone<a href={SITE.phoneHref}>{SITE.phone}</a></span>
              </li>
              <li>
                <LuMail aria-hidden="true" />
                <span>Email<a href={`mailto:${SITE.email}`}>{SITE.email}</a></span>
              </li>
              <li>
                <LuMapPin aria-hidden="true" />
                <span>Office<strong>{SITE.address.locality}, {SITE.address.country}</strong></span>
              </li>
              <li>
                <LuClock aria-hidden="true" />
                <span>Opening hours<strong>{SITE.openingHours}</strong></span>
              </li>
            </ul>
            <a href={MAP_HREF} className="cp-map" target="_blank" rel="noreferrer">
              <LuMapPin aria-hidden="true" />
              <span>
                <strong>{SITE.address.locality}, {SITE.address.country}</strong>
                Open in Google Maps
              </span>
            </a>
            <p className="cp-note">
              Already booked? <Link to="/my-booking">Open my booking</Link> to see your trip, pickup and payment.
            </p>
          </section>

          <section
            ref={card}
            className={`cp-card cp-card-form is-${phase}`}
            aria-labelledby={phase === "sent" || phase === "error" ? "cp-result-title" : "cp-form-title"}
            style={lockedHeight ? { minHeight: lockedHeight } : undefined}
          >
            <div className={`cp-progress is-${progress}`} aria-hidden="true">
              <span />
            </div>
            <div aria-live="polite">
              {phase === "sent" ? (
                <div className="cp-result">
                  <ResultIcon kind="sent" />
                  <h2 id="cp-result-title" ref={heading} tabIndex={-1}>{firstName ? `Thank you, ${firstName}!` : "Thank you!"}</h2>
                  <p className="cp-result-text">Your message has reached our team. We&apos;ll reply within 24 hours by email or WhatsApp.</p>
                  <dl className="cp-summary">
                    <div>
                      <dt>Sent to</dt>
                      <dd>{form.email.trim()}</dd>
                    </div>
                    {form.travelDate ? (
                      <div>
                        <dt>Travel date</dt>
                        <dd>{travelDateLabel(form.travelDate)}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <div className="cp-result-actions">
                    <button type="button" className="cp-btn cp-btn-brand" onClick={sendAnother}>Send another message</button>
                    {whatsapp ? (
                      <a href={whatsapp} className="cp-btn cp-btn-outline-whatsapp" target="_blank" rel="noreferrer">
                        <LuMessageCircle aria-hidden="true" /> Chat on WhatsApp
                      </a>
                    ) : null}
                  </div>
                  <p className="cp-result-note">Check your spam folder if you don&apos;t see our reply.</p>
                </div>
              ) : null}

              {phase === "error" ? (
                <div className="cp-result">
                  <ResultIcon kind="error" />
                  <h2 id="cp-result-title" ref={heading} tabIndex={-1}>Message not sent</h2>
                  <p className="cp-result-text">
                    {errorKind === "rate"
                      ? "Too many messages. Please wait a few minutes and try again."
                      : "Something went wrong on our side. Don't worry, everything you typed is saved."}
                  </p>
                  <div className="cp-result-actions">
                    <button type="button" className="cp-btn cp-btn-brand" onClick={tryAgain}>
                      <LuRefreshCw aria-hidden="true" /> Try again
                    </button>
                    {visitorWhatsapp ? (
                      <a href={visitorWhatsapp} className="cp-btn cp-btn-outline-whatsapp" target="_blank" rel="noreferrer">
                        <LuMessageCircle aria-hidden="true" /> Message us on WhatsApp
                      </a>
                    ) : null}
                    <a href={emailHref} className="cp-btn cp-btn-outline">
                      <LuMail aria-hidden="true" /> Email us
                    </a>
                  </div>
                  <p className="cp-result-note">&quot;Try again&quot; brings back your form with all details filled in.</p>
                </div>
              ) : null}
            </div>

            {phase === "idle" || phase === "sending" ? (
              <>
                <h2 id="cp-form-title">Send us a message</h2>
                <form className="cp-form" onSubmit={submit} noValidate aria-describedby={ids.status} aria-busy={sending || undefined}>
                  <div className="cp-row">
                    <label htmlFor={ids.name}>Name</label>
                    <input id={ids.name} autoComplete="name" {...field("name")} />
                    {errors.name ? <small id={`${ids.name}-error`} className="cp-error">{errors.name}</small> : null}
                  </div>
                  <div className="cp-row">
                    <label htmlFor={ids.email}>Email</label>
                    <input id={ids.email} type="email" inputMode="email" autoComplete="email" {...field("email")} />
                    {errors.email ? <small id={`${ids.email}-error`} className="cp-error">{errors.email}</small> : null}
                  </div>
                  <div className="cp-two">
                    <div className="cp-row">
                      <label htmlFor={ids.phone}>Phone / WhatsApp <span>(optional)</span></label>
                      <input id={ids.phone} type="tel" autoComplete="tel" {...field("phone")} />
                    </div>
                    <div className="cp-row">
                      <label htmlFor={ids.date}>Travel date <span>(optional)</span></label>
                      <input id={ids.date} type="date" {...field("travelDate")} />
                    </div>
                  </div>
                  <div className="cp-row">
                    <label htmlFor={ids.message}>Message</label>
                    <textarea id={ids.message} rows={5} placeholder="Your dates, hotel and what you'd like to do" {...field("message")} />
                    {errors.message ? <small id={`${ids.message}-error`} className="cp-error">{errors.message}</small> : null}
                  </div>
                  {/* Robots fill this in; people never see it. */}
                  <div className="cp-trap" aria-hidden="true">
                    <label>
                      Website
                      <input tabIndex={-1} autoComplete="off" {...field("website")} />
                    </label>
                  </div>
                  <button
                    ref={submitButton}
                    type="submit"
                    className={`cp-btn cp-btn-brand cp-submit ${sending ? "is-sending" : ""}`.trim()}
                    aria-busy={sending || undefined}
                    aria-disabled={sending || undefined}
                  >
                    {sending ? (
                      <>
                        <span className="cp-dots" aria-hidden="true"><span /><span /><span /></span>
                        Sending
                      </>
                    ) : (
                      "Send message"
                    )}
                  </button>
                  <p id={ids.status} className={`cp-status ${status ? "is-error" : ""}`} aria-live="polite">
                    {status}
                  </p>
                </form>
              </>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
};

export default ContactPage;
