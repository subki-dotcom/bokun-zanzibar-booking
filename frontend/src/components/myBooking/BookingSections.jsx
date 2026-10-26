// The cards of the booking page (mockups "MyBooking" and "MyBookingMobile"). Data comes from the server already
// masked; nothing here reads or shows a full name, email or phone number.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  LuCalendar,
  LuCalendarClock,
  LuChevronRight,
  LuCircleX,
  LuClock,
  LuDownload,
  LuMessageCircle,
  LuUser,
  LuUserPlus
} from "react-icons/lu";
import { SITE } from "../../config/site";
import { calendarEvent, googleCalendarHref, icsFile } from "../payment/paymentData";
import { trackAnalyticsEvent } from "../../utils/analytics";
import { ticketPdfUrl, ticketQrUrl } from "../../api/myBookingApi";
import MaskedText from "./MaskedText";
import {
  countdownTile,
  dayBeforeLabel,
  daysToGoText,
  instantDay,
  instantDayTime,
  longDate,
  longDateNoYear,
  money,
  paidOnLabel,
  policyBar,
  shareText,
  shortDate,
  shortDateYear,
  ticketDate,
  whatsappTripHref
} from "./myBookingData";

const MAPS_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_STATIC_KEY || "").trim();

export const StatusPill = ({ status }) => (
  <p className={`mb-status is-${status.tone}`}>
    <span className="mb-status-dot" aria-hidden="true" />
    <span>
      <span className="mb-visually-hidden">Booking status: </span>
      {status.label}
    </span>
  </p>
);

export const BookingHero = ({ data }) => {
  const desktopLine = [data.tour.option, longDate(data.date), data.startTime ? `${data.startTime} (Zanzibar time)` : ""].filter(Boolean).join(" · ");
  const phoneLine = [shortDateYear(data.date), data.startTime, daysToGoText(data)].filter(Boolean).join(" · ");
  return (
    <header className="mb-hero" style={data.tour.image ? { backgroundImage: `url("${data.tour.image}")` } : undefined}>
      <div className="mb-container">
        <nav className="mb-breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li><Link to="/">Home</Link></li>
            <li><Link to="/my-booking">My booking</Link></li>
            <li aria-current="page">{data.reference}</li>
          </ol>
        </nav>
        <StatusPill status={data.status} />
        <h1>{data.tour.title}</h1>
        <p className="mb-hero-sub">
          <span className="mb-desktop-only">{desktopLine}</span>
          <span className="mb-mobile-only">{phoneLine}</span>
        </p>
      </div>
    </header>
  );
};

export const KeyFacts = ({ data }) => {
  const tile = countdownTile({ phase: data.phase, daysToGo: data.daysToGo, status: data.status.key });
  return (
    <section className="mb-facts" aria-label="Key facts">
      <dl className="mb-fact">
        <span className="mb-fact-icon" aria-hidden="true"><LuCalendar /></span>
        <div><dt>Date</dt><dd>{shortDate(data.date) || "—"}</dd></div>
      </dl>
      <dl className="mb-fact">
        <span className="mb-fact-icon" aria-hidden="true"><LuClock /></span>
        <div>
          <dt>{data.pickup?.type === "meeting" ? "Start time" : "Pickup"}</dt>
          <dd>{data.startTime || "To be confirmed"}</dd>
        </div>
      </dl>
      <dl className="mb-fact">
        <span className="mb-fact-icon" aria-hidden="true"><LuUser /></span>
        <div><dt>Travelers</dt><dd>{data.travelersLabel}</dd></div>
      </dl>
      <dl className="mb-fact is-dark">
        <span className="mb-fact-icon" aria-hidden="true">{tile.big}</span>
        <div>
          <dt>{tile.label}</dt>
          <dd>
            {data.phase === "past" && data.tour.slug ? <Link to={`/tours/${data.tour.slug}#reviews`}>Leave a review</Link> : tile.caption}
          </dd>
        </div>
      </dl>
    </section>
  );
};

export const DayTimeline = ({ data }) => {
  if (!data.timeline.length || data.status.key === "cancelled") return null;
  const label = (row) => (row.time === "day_before" ? dayBeforeLabel(data.date) : row.time);
  return (
    <section className="mb-card mb-section" aria-labelledby="mb-day-title">
      <span className="mb-eyebrow">Your day</span>
      <h2 id="mb-day-title" className="mb-section-day-title">What happens on {longDateNoYear(data.date)}</h2>
      <ol className="mb-timeline">
        {data.timeline.map((row) => (
          <li key={row.key} className={[row.highlight ? "is-highlight" : "", row.key === "end" ? "is-end" : ""].filter(Boolean).join(" ")}>
            <span className="mb-tl-time">{row.time === "day_before" ? <abbr title="The day before your trip">{label(row)}</abbr> : <time>{label(row)}</time>}</span>
            <span className="mb-tl-dot" aria-hidden="true" />
            <div>
              <strong>
                {row.key === "day_before" ? (
                  <>
                    <span className="mb-desktop-only">{row.title}</span>
                    <span className="mb-mobile-only">Pickup details on WhatsApp</span>
                  </>
                ) : (
                  row.title
                )}
              </strong>
              <p>{row.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mb-visually-hidden">All times are Zanzibar time.</p>
    </section>
  );
};

// A static map (Google Static Maps when a key is set), loaded lazily; otherwise a drawn placeholder with a pin.
export const StaticMap = ({ pickup }) => {
  const query = pickup.coordinates ? `${pickup.coordinates.lat},${pickup.coordinates.lng}` : `${pickup.name}, Zanzibar`;
  const src = MAPS_KEY
    ? `https://maps.googleapis.com/maps/api/staticmap?${new URLSearchParams({
        center: query,
        zoom: "15",
        size: "640x400",
        scale: "2",
        markers: `color:0x0E6B57|${query}`,
        key: MAPS_KEY
      }).toString()}`
    : "";
  return (
    <div className="mb-map">
      {src ? (
        <img src={src} alt={`Map showing ${pickup.name}`} loading="lazy" decoding="async" />
      ) : (
        <>
          <svg className="mb-map-art" viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <rect width="400" height="240" fill="#dfe8e4" />
            <path d="M-10 170 C 90 120, 180 210, 410 120" stroke="#fff" strokeWidth="16" fill="none" />
            <path d="M120 -10 C 140 80, 110 160, 150 250" stroke="#fff" strokeWidth="10" fill="none" />
            <path d="M260 -10 C 250 90, 300 170, 270 250" stroke="#fff" strokeWidth="8" fill="none" />
          </svg>
          <span className="mb-map-pin" aria-hidden="true" />
          <span className="mb-map-label">Map preview</span>
        </>
      )}
    </div>
  );
};

export const PickupCard = ({ data, onChangePickup }) => {
  const { pickup } = data;
  if (!pickup || data.status.key === "cancelled") return null;
  const meeting = pickup.type === "meeting";
  return (
    <section className="mb-card mb-pickup" aria-labelledby="mb-pickup-title">
      <StaticMap pickup={pickup} />
      <div className="mb-pickup-body">
        <span className="mb-eyebrow">{meeting ? "Meeting point" : "Pickup point"}</span>
        <h2 id="mb-pickup-title" className="mb-visually-hidden">{meeting ? "Meeting point" : "Pickup point"}</h2>
        <h3>{pickup.name}</h3>
        <p className="mb-address">{pickup.address}</p>
        <p className="mb-instruction">{pickup.instruction}</p>
        <div className="mb-pickup-actions">
          <a className="mb-btn mb-btn-dark" href={pickup.mapsUrl} target="_blank" rel="noreferrer">
            Open in Google Maps<span className="mb-mobile-only" aria-hidden="true"> ›</span>
          </a>
          {!meeting && data.actions.changePickup.allowed ? (
            <button type="button" className="mb-btn mb-btn-outline" onClick={onChangePickup}>
              Change pickup
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
};

export const PolicyBar = ({ data, now = Date.now() }) => {
  const bar = policyBar({ policy: data.policy, now });
  if (!bar) return <p className="mb-policy-text">{data.policy.summary || data.policy.refundLine}</p>;
  const free = bar.freePercent;
  return (
    <div className="mb-policy">
      <div
        className="mb-policy-track"
        role="img"
        aria-label={
          data.policy.deadlinePassed
            ? `Free cancellation ended on ${instantDayTime(data.policy.deadline)} (Zanzibar time).`
            : `Free cancellation and changes until ${instantDayTime(data.policy.deadline)} (Zanzibar time). No refund after that.`
        }
      >
        <span className="mb-policy-free" style={{ width: `${free}%` }} />
      </div>
      <div className="mb-policy-labels" aria-hidden="true">
        {data.policy.deadlinePassed ? (
          <span className="is-late"><strong>Today</strong> · free cancellation has ended</span>
        ) : (
          <span className="is-free">
            <strong>Today</strong> · {data.policy.freeCancellation ? "free cancellation & changes" : "changes possible"}
          </span>
        )}
        {!data.policy.deadlinePassed ? (
          <span><strong>{instantDayTime(data.policy.deadline)}</strong> · deadline</span>
        ) : null}
        <span className="is-late"><strong>{instantDay(data.policy.span.tripAt)}</strong> · {data.policy.refundable ? "no refund" : "trip day"}</span>
      </div>
      <p className="mb-mobile-only mb-policy-mobile">
        {data.policy.deadlinePassed ? (
          "Free cancellation has ended"
        ) : (
          <>
            <strong className="mb-good">Free cancellation</strong> until {instantDayTime(data.policy.deadline)}
          </>
        )}
      </p>
    </div>
  );
};

const ActionRow = ({ icon, title, sub, subGood = false, danger = false, action, onClick }) => {
  const disabledReasonId = `mb-action-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <li className={`mb-action ${danger ? "is-danger" : ""}`.trim()}>
      <button type="button" onClick={onClick} disabled={!action.allowed} aria-describedby={disabledReasonId}>
        <span className="mb-action-icon" aria-hidden="true">{icon}</span>
        <span className="mb-action-text">
          <strong>{title}</strong>
          <small id={disabledReasonId} className={action.allowed && subGood ? "is-good" : ""}>{action.allowed ? sub : action.reason}</small>
        </span>
        <LuChevronRight className="mb-action-chevron" aria-hidden="true" />
      </button>
    </li>
  );
};

export const ManageBooking = ({ data, onChangeDate, onChangeTravelers, onCancel }) => {
  const noFee = data.policy.freeCancellation ? "no fee before the deadline" : "our team checks availability and any price difference";
  return (
    <section className="mb-card mb-section" aria-labelledby="mb-manage-title">
      <div className="mb-section-head">
        <div>
          <span className="mb-eyebrow">Flexibility</span>
          <h2 id="mb-manage-title">Manage your booking</h2>
        </div>
        <p className="mb-section-note">Requests are reviewed by our team – usually within 24 hours</p>
      </div>
      {data.status.key !== "cancelled" ? <PolicyBar data={data} /> : null}
      <ul className="mb-actions">
        <ActionRow
          icon={<LuCalendarClock />}
          title="Change date or time"
          sub={`Pick a new date – subject to availability, ${noFee}`}
          action={data.actions.changeDate}
          onClick={onChangeDate}
        />
        <ActionRow
          icon={<LuUserPlus />}
          title="Change travelers"
          sub="Add or remove people – price difference shown before you confirm"
          action={data.actions.changeTravelers}
          onClick={onChangeTravelers}
        />
        <ActionRow
          icon={<LuCircleX />}
          title="Cancel booking"
          sub={data.policy.refundLine}
          subGood={data.policy.freeCancellation}
          danger
          action={data.actions.cancel}
          onClick={onCancel}
        />
      </ul>
    </section>
  );
};

// "Add to calendar": an .ics file for any calendar app, or Google Calendar.
const CalendarMenu = ({ data }) => {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const event = useMemo(
    () =>
      calendarEvent({
        date: data.date,
        time: data.startTime,
        tour: { title: data.tour.title, duration: data.tour.duration, option: data.tour.option },
        pickupHotel: data.pickup?.name || "",
        bookingReference: data.reference
      }),
    [data]
  );
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
    const blob = new Blob([icsFile(event, data.reference)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "zanzibar-trip.ics";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    trackAnalyticsEvent("add_to_calendar");
    setOpen(false);
  };
  return (
    <div className="mb-menu-wrap" ref={wrap}>
      <button type="button" className="mb-btn mb-btn-outline" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Add to calendar
      </button>
      {open ? (
        <div className="mb-menu" role="menu">
          <button type="button" role="menuitem" onClick={download}>Apple, Outlook &amp; others (.ics)</button>
          <a
            role="menuitem"
            href={googleCalendarHref(event)}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              trackAnalyticsEvent("add_to_calendar");
              setOpen(false);
            }}
          >
            Google Calendar
          </a>
        </div>
      ) : null}
    </div>
  );
};

export const Perforation = () => (
  <div className="mb-perforation" aria-hidden="true">
    <span />
    <span />
  </div>
);

// The QR code holds the reference and a signature only (made on the server); no personal data.
export const QrCode = ({ reference }) => (
  <div className="mb-qr">
    <img src={ticketQrUrl(reference)} alt={`QR code for booking ${reference}`} width="84" height="84" />
  </div>
);

export const ETicketCard = ({ data, onCopied, onShowContact, onToast }) => {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.reference);
      onCopied();
    } catch {
      onToast("Copy didn't work – please select the reference");
    }
  };
  const share = async () => {
    const text = shareText(data);
    try {
      if (navigator.share) {
        await navigator.share({ title: data.tour.title, text });
      } else {
        await navigator.clipboard.writeText(text);
        onToast("Trip details copied");
      }
    } catch {
      // Closing the share sheet is not an error.
    }
  };
  const cancelled = data.status.key === "cancelled";
  return (
    <section className="mb-ticket" aria-labelledby="mb-ticket-title">
      <div className="mb-ticket-bar">
        <h2 id="mb-ticket-title">
          <span className="mb-ticket-logo" aria-hidden="true">{SITE.name.charAt(0)}</span> E-ticket
        </h2>
        <small>{cancelled ? "Cancelled – not valid" : "Show at pickup"}</small>
      </div>
      <div className="mb-ticket-body">
        <dl>
          <div className="is-wide">
            <dt>Experience</dt>
            <dd>{[data.tour.title, data.tour.option].filter(Boolean).join(" · ")}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{ticketDate(data.date) || "—"}</dd>
          </div>
          <div>
            <dt>{data.pickup?.type === "meeting" ? "Start" : "Pickup"}</dt>
            <dd>{data.startTime || "TBC"}</dd>
          </div>
          <div>
            <dt>Lead traveler</dt>
            <dd>
              <MaskedText value={data.lead.name} label="Lead traveler name" />
            </dd>
            <button type="button" className="mb-link mb-contact-link" onClick={onShowContact}>Show details</button>
          </div>
          <div>
            <dt>Travelers</dt>
            <dd>{data.travelersLabel}</dd>
          </div>
        </dl>
        <Perforation />
        <div className="mb-ticket-code">
          <QrCode reference={data.reference} />
          <div className="mb-ticket-ref">
            <small>Booking reference</small>
            <strong>{data.reference}</strong>
            <button type="button" className="mb-pill-btn" onClick={copy} aria-label={`Copy booking reference ${data.reference}`}>
              Copy
            </button>
          </div>
        </div>
        <div className="mb-ticket-actions">
          {!cancelled ? (
            <a className="mb-btn mb-btn-primary" href={ticketPdfUrl(data.reference)} download onClick={() => trackAnalyticsEvent("download_ticket")}>
              <LuDownload aria-hidden="true" /> Download e-ticket<span className="mb-desktop-only">&nbsp;(PDF)</span>
            </a>
          ) : null}
          <CalendarMenu data={data} />
          <button type="button" className="mb-btn mb-btn-outline" onClick={share}>
            Share trip
          </button>
        </div>
      </div>
    </section>
  );
};

export const ReceiptCard = ({ data }) => {
  const { receipt } = data;
  const paidLine = ["Paid", receipt.method ? `Card via ${receipt.method}` : "", paidOnLabel(receipt.paidAt)].filter(Boolean).join(" · ");
  return (
    <section className="mb-card mb-receipt" aria-labelledby="mb-receipt-title">
      <div className="mb-receipt-head">
        <h2 id="mb-receipt-title">Receipt</h2>
        {receipt.invoiceAvailable ? <Link to={`/invoice/${encodeURIComponent(data.reference)}`}>Invoice PDF</Link> : null}
      </div>
      <dl className="mb-receipt-rows">
        <div className="mb-desktop-only-flex">
          <dt>{receipt.lineItem}</dt>
          <dd>{money(receipt.total, receipt.currency)}</dd>
        </div>
        <div className="mb-desktop-only-flex">
          <dt>Taxes &amp; fees</dt>
          <dd>{receipt.taxes}</dd>
        </div>
        {receipt.paid ? (
          <div className="is-paid">
            <dt>{paidLine}</dt>
            <dd>{money(receipt.amountPaid, receipt.currency)}</dd>
          </div>
        ) : null}
        {receipt.amountRefunded > 0 ? (
          <div>
            <dt>Refunded</dt>
            <dd>−{money(receipt.amountRefunded, receipt.currency)}</dd>
          </div>
        ) : null}
      </dl>
      <dl className={`mb-balance ${receipt.balanceDue > 0 ? "is-due" : ""}`.trim()}>
        <dt>Balance due</dt>
        <dd>{money(receipt.balanceDue, receipt.currency)}</dd>
      </dl>
      {data.payHref ? (
        <Link className="mb-btn mb-btn-primary mb-btn-block" to={data.payHref}>
          Pay now
        </Link>
      ) : null}
    </section>
  );
};

export const HelpCard = ({ data }) => {
  const href = whatsappTripHref(SITE.whatsappHref, data.reference, data.tour.title);
  return (
    <section className="mb-help" aria-labelledby="mb-help-title">
      <div className="mb-help-head">
        <span className="mb-help-avatar" aria-hidden="true"><LuMessageCircle size={20} /></span>
        <div>
          <h2 id="mb-help-title">Questions about your trip?</h2>
          <p>Our Zanzibar team is on WhatsApp</p>
        </div>
      </div>
      {href ? (
        <a className="mb-btn" href={href} target="_blank" rel="noreferrer" onClick={() => trackAnalyticsEvent("whatsapp_click", { link_location: "public_site" })}>
          <span className="mb-desktop-only">Chat with us</span>
          <span className="mb-mobile-only">Chat on WhatsApp</span>
        </a>
      ) : null}
      <p className="mb-help-contacts">
        <a href={SITE.phoneHref}>{SITE.phone}</a> · <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
      </p>
    </section>
  );
};
