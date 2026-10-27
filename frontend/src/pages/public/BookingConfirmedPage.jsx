import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LuCalendarPlus, LuCheck, LuDownload, LuMessageCircle } from "react-icons/lu";
import "../../components/checkout/checkout.css";
import "../../components/payment/payment.css";
import "../../components/payment/confirmed.css";
import { BRAND } from "../../config/brand";
import useMediaQuery from "../../hooks/useMediaQuery";
import { fetchBookingPaymentStatus } from "../../api/paymentsApi";
import { fetchTours } from "../../api/toursApi";
import { initializeAnalytics, trackPurchase, trackSelectItem } from "../../utils/analytics";
import { formatDeadline, formatMoney, formatTripDate, travellersText } from "../../components/checkout/checkoutData";
import ReferenceBox from "../../components/payment/ReferenceBox";
import SiteHeader from "../../components/common/siteHeader/SiteHeader";
import { calendarEvent, googleCalendarHref, icsFile, paymentPageHref, whatsappReferenceHref } from "../../components/payment/paymentData";

// The checkout header with every step done.
const Header = () => <SiteHeader variant="checkout" step={3} />;

// "Add to calendar": an .ics file for any calendar app, or Google Calendar.
const CalendarButton = ({ data }) => {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const event = useMemo(() => calendarEvent(data), [data]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !wrap.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!event) return null;
  const download = () => {
    const blob = new Blob([icsFile(event, data.bookingReference)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${data.bookingReference || "booking"}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setOpen(false);
  };
  return (
    <div className="bc-calendar" ref={wrap}>
      <button type="button" className="bc-outline" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <LuCalendarPlus aria-hidden="true" /> Add to calendar
      </button>
      {open ? (
        <div className="bc-menu" role="menu">
          <button type="button" role="menuitem" onClick={download}>Apple, Outlook &amp; others (.ics)</button>
          <a role="menuitem" href={googleCalendarHref(event)} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>Google Calendar</a>
        </div>
      ) : null}
    </div>
  );
};

const NEXT_STEPS = [
  ["Day before:", "your guide sends the exact pickup time on WhatsApp."],
  ["On the day:", "wait at your hotel reception with your booking reference."],
  ["After the tour:", "we'd love your review – it helps other travelers."]
];

const RelatedTours = ({ slug }) => {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let active = true;
    fetchTours({ page: 1, limit: 12 })
      .then((result) => active && setRows(result.items || []))
      .catch(() => active && setRows([]));
    return () => {
      active = false;
    };
  }, []);
  const related = rows.filter((row) => row.slug && row.slug !== slug && Number(row.fromPrice) > 0).slice(0, 3);
  if (!related.length) return null;
  return (
    <section className="bc-related" aria-labelledby="bc-related-title">
      <h2 id="bc-related-title">Make more of your Zanzibar trip</h2>
      <div className="bc-related-grid">
        {related.map((row) => {
          const image = Array.isArray(row.images) ? (typeof row.images[0] === "string" ? row.images[0] : row.images[0]?.url) : "";
          return (
            <Link key={row.slug} to={`/tours/${row.slug}`} onClick={() => trackSelectItem(row)} className="bc-related-card">
              <span className="bc-related-image">{image ? <img src={image} alt="" loading="lazy" /> : null}</span>
              <span className="bc-related-text">
                <strong>{row.title}</strong>
                <small>From <b>{formatMoney(row.fromPrice, row.currency || "USD")}</b></small>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
};

// /booking/confirmed/:reference?key=… (mockups "Confirmed" and "ConfirmedMobile"): refresh-safe, from the server status.
const BookingConfirmedPage = () => {
  const { reference = "" } = useParams();
  const [searchParams] = useSearchParams();
  const key = String(searchParams.get("key") || "").trim();
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 767.98px)");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const headingRef = useRef(null);

  useEffect(() => {
    let active = true;
    fetchBookingPaymentStatus(reference, { key })
      .then((result) => {
        if (!active) return;
        // Not paid yet: the payment page knows what to show.
        if (result.status !== "paid") navigate(paymentPageHref({ reference, key: result.key || key }), { replace: true });
        else setData(result);
      })
      .catch((err) => active && setError(err.message || "We could not open this booking."));
    return () => {
      active = false;
    };
  }, [reference, key, navigate]);

  useEffect(() => {
    if (data) headingRef.current?.focus({ preventScroll: true });
  }, [data]);

  // GA4 purchase, once per reference, only with analytics consent (the analytics module enforces both).
  useEffect(() => {
    if (!data?.analyticsPurchase) return undefined;
    const report = () => {
      if (initializeAnalytics()) void trackPurchase(data.analyticsPurchase);
    };
    report();
    window.addEventListener("zts:analytics-consent", report);
    return () => window.removeEventListener("zts:analytics-consent", report);
  }, [data]);

  if (error) {
    return (
      <div className="ck bc">
        <Header />
        <main className="bc-container">
          <section className="ck-card bc-card bc-hero">
            <h1 tabIndex={-1}>We couldn't open this booking</h1>
            <p>{error} You can find it under <Link to="/my-booking">My booking</Link>.</p>
          </section>
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="ck bc">
        <Header />
        <main className="bc-container" aria-busy="true">
          <section className="ck-card bc-card bc-hero">
            <span className="bc-check is-loading" aria-hidden="true" />
            <span className="ck-skeleton" style={{ width: 260, height: 32 }} />
            <span className="ck-skeleton" style={{ width: 320, height: 16, marginTop: 14 }} />
          </section>
        </main>
      </div>
    );
  }

  const deadline = data.cancellationDeadline ? new Date(data.cancellationDeadline) : null;
  const showCancellation = deadline && !Number.isNaN(deadline.getTime()) && deadline.getTime() > Date.now();
  const confirmed = data.supplierConfirmed;
  const name = data.customerFirstName || "";
  const subtitle = [data.tour?.option, data.tour?.language ? `${data.tour.language} guide` : ""].filter(Boolean).join(" · ");
  const whatsapp = whatsappReferenceHref(BRAND.whatsappHref, data.bookingReference, data.tour?.title);
  const pickupValue = data.time ? `${data.tour?.pickup ? "~" : ""}${data.time}` : "To be confirmed";

  return (
    <div className="ck bc">
      <Header />
      <main className="bc-container">
        <section className="ck-card bc-card bc-hero" aria-labelledby="bc-title">
          <span className="bc-check" aria-hidden="true"><LuCheck /></span>
          <h1 id="bc-title" tabIndex={-1} ref={headingRef}>
            {confirmed ? `You're all set${name ? `, ${name}` : ""}!` : `Payment received${name ? `, ${name}` : ""}!`}
          </h1>
          <p className="bc-lead" role="status">
            {confirmed ? "Your booking is confirmed and paid. " : "Your payment is confirmed. We're finishing your booking with the tour operator. "}
            {data.maskedEmail ? (
              <>
                {confirmed ? "We've sent your ticket to " : "Your ticket follows by email to "}
                <strong>{data.maskedEmail}</strong>.
              </>
            ) : null}
          </p>
          <ReferenceBox reference={data.bookingReference} className="bc-reference" />
          <div className="bc-actions">
            <button type="button" className="ck-btn bc-primary" onClick={() => window.print()}>
              <LuDownload aria-hidden="true" /> Download ticket (PDF)
            </button>
            <CalendarButton data={data} />
          </div>
        </section>

        <section className="ck-card bc-card bc-trip" aria-label="Your trip">
          <div className="bc-trip-head">
            {data.tour?.image ? <img src={data.tour.image} alt="" width="96" height="96" /> : <span className="bc-trip-img" />}
            <div>
              <h2>{data.tour?.title}</h2>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
          </div>
          <dl className="bc-tiles">
            <div><dt>Date</dt><dd>{formatTripDate(data.date)}</dd></div>
            <div><dt>{data.tour?.pickup ? "Pickup" : "Start"}</dt><dd>{pickupValue}</dd></div>
            <div><dt>Travelers</dt><dd>{travellersText(data.travelers)}</dd></div>
          </dl>
          <div className="bc-paid">
            <span>Paid{data.paymentMethod ? ` · ${data.paymentMethod}` : ""}</span>
            <strong>{formatMoney(data.amountPaid || data.amount, data.currency)}</strong>
          </div>
          {showCancellation ? (
            <p className="ck-free bc-free">
              <LuCheck aria-hidden="true" />
              <span>
                <strong>Free cancellation</strong> until {formatDeadline(deadline)} ·{" "}
                {/* The payment key signs the guest in to "My booking" on this device. */}
                <Link to={`/my-booking/${encodeURIComponent(data.bookingReference)}?key=${encodeURIComponent(data.key || key)}`}>Manage or cancel</Link>
              </span>
            </p>
          ) : null}
        </section>

        <section className="ck-card bc-card bc-next" aria-labelledby="bc-next-title">
          <h2 id="bc-next-title">What happens next</h2>
          <ol>
            {NEXT_STEPS.map(([lead, rest], index) => (
              <li key={lead}>
                <span aria-hidden="true">{index + 1}</span>
                <p><strong>{lead}</strong> {rest}</p>
              </li>
            ))}
          </ol>
          {data.tour?.whatToBring?.length ? (
            <div className="bc-bring">
              <h3>What to bring</h3>
              <ul>
                {data.tour.whatToBring.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}
        </section>

        {isMobile && whatsapp ? (
          <a className="ck-card bc-card bc-help-m" href={whatsapp} target="_blank" rel="noreferrer">
            <span className="bc-help-icon" aria-hidden="true"><LuMessageCircle /></span>
            <span>
              <strong>Questions? Chat with us</strong>
              <small>WhatsApp · we reply fast</small>
            </span>
          </a>
        ) : (
        <section className="ck-card bc-card bc-help" aria-label="Questions about your trip?">
          <div>
            <strong>Questions about your trip?</strong>
            <small>
              <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a> · <a href={BRAND.phoneHref}>{BRAND.phone}</a>
            </small>
          </div>
          {whatsapp ? (
            <a className="bc-outline bc-whatsapp" href={whatsapp} target="_blank" rel="noreferrer">
              <LuMessageCircle aria-hidden="true" /> Chat on WhatsApp
            </a>
          ) : null}
        </section>
        )}

        <RelatedTours slug={data.tour?.slug} />
      </main>
    </div>
  );
};

export default BookingConfirmedPage;
