import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { LuClock, LuMail, LuMapPin, LuMessageCircle, LuPhone } from "react-icons/lu";
import SeoHead from "../../components/common/SeoHead";
import { sendContactMessage } from "../../api/marketingApi";
import { SITE, whatsappLink } from "../../config/site";
import { SITE_PAGES } from "../../config/sitePages";
import "./contactPage.css";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMPTY = { name: "", email: "", phone: "", travelDate: "", message: "", website: "" };
const MAP_HREF = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${SITE.address.locality}, ${SITE.address.country}`)}`;

const errorsFor = (form) => {
  const errors = {};
  if (!form.name.trim()) errors.name = "Please enter your name.";
  if (!EMAIL_PATTERN.test(form.email.trim())) errors.email = "Please enter a valid email address.";
  if (form.message.trim().length < 5) errors.message = "Please tell us a little about your trip.";
  return errors;
};

// /contact: WhatsApp, phone, email, address, hours and a short message form (sent to the team's inbox).
const ContactPage = () => {
  const page = SITE_PAGES.contact;
  const ids = { name: useId(), email: useId(), phone: useId(), date: useId(), message: useId(), status: useId() };
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState({ type: "", text: "" });
  const [sending, setSending] = useState(false);
  const whatsapp = whatsappLink(SITE.whatsappHelloMessage);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    const found = errorsFor(form);
    setErrors(found);
    if (Object.keys(found).length) {
      setStatus({ type: "error", text: "Please check the highlighted fields." });
      return;
    }
    setSending(true);
    setStatus({ type: "", text: "" });
    try {
      await sendContactMessage({ ...form, name: form.name.trim(), email: form.email.trim() });
      setForm(EMPTY);
      setStatus({ type: "success", text: "Thank you! Your message is on its way – we'll reply by email or WhatsApp." });
    } catch (error) {
      setStatus({ type: "error", text: error.message || "We could not send your message. Please try WhatsApp instead." });
    } finally {
      setSending(false);
    }
  };
  const field = (key) => ({
    value: form[key],
    onChange: set(key),
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `${ids[key === "travelDate" ? "date" : key]}-error` : undefined
  });

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

          <section className="cp-card" aria-labelledby="cp-form-title">
            <h2 id="cp-form-title">Send us a message</h2>
            <form className="cp-form" onSubmit={submit} noValidate aria-describedby={ids.status}>
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
              <button type="submit" className="cp-btn cp-btn-brand" disabled={sending}>
                {sending ? "Sending…" : "Send message"}
              </button>
              <p id={ids.status} className={`cp-status ${status.type ? `is-${status.type}` : ""}`} aria-live="polite">
                {status.text}
              </p>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
};

export default ContactPage;
