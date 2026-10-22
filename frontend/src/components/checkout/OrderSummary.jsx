import { Link } from "react-router-dom";
import { LuCalendar, LuCheck, LuChevronDown, LuClock, LuMessageCircle, LuMessageSquare, LuUser } from "react-icons/lu";
import { BRAND } from "../../config/brand";
import { shortTourName } from "../tours/tourPage/tourPageData";
import {
  formatDeadline,
  formatMoney,
  formatTripDate,
  freeCancellationDeadline,
  priceLines,
  travellersText,
  whatsappHelpHref
} from "./checkoutData";

const Skeleton = ({ width = 80 }) => <span className="ck-skeleton" style={{ width }} aria-hidden="true" />;

// Values the summaries share, from the trip and the live quote.
export const summaryFacts = (checkout) => {
  const { tour, trip, cancellationPolicy, pricing, hasPickup } = checkout;
  const deadline = freeCancellationDeadline({
    travelDate: trip.travelDate,
    startTime: trip.startTime,
    policy: cancellationPolicy,
    policyText: tour?.cancellationPolicy || ""
  });
  const duration = String(tour?.duration || "").trim();
  return {
    image: tour?.images?.[0] || "",
    date: formatTripDate(trip.travelDate),
    shortDate: formatTripDate(trip.travelDate, { year: false }),
    time: [trip.startTime ? `${trip.startTime} ${hasPickup ? "pickup" : "start"}` : "", duration].filter(Boolean).join(" · "),
    travellers: travellersText(trip.pax),
    guide: checkout.language ? `${checkout.language} guide` : "",
    deadline,
    lines: priceLines(pricing)
  };
};

const FreeCancellation = ({ deadline, year = true }) =>
  deadline ? (
    <p className="ck-free">
      <LuCheck aria-hidden="true" />
      <span>
        <strong>Free cancellation</strong> until {formatDeadline(deadline, { year })}
      </span>
    </p>
  ) : null;

const PriceLines = ({ checkout, lines }) => {
  if (!checkout.pricing) {
    return (
      <div className="ck-lines" aria-busy="true">
        <div><Skeleton width={140} /><Skeleton width={64} /></div>
      </div>
    );
  }
  return (
    <div className="ck-lines">
      {lines.map((line) => (
        <div key={line.label}>
          <span>{line.label}</span>
          <span>{line.amount}</span>
        </div>
      ))}
      <div className="ck-lines-muted">
        <span>Taxes &amp; fees</span>
        <span>Included</span>
      </div>
    </div>
  );
};

const TotalAmount = ({ checkout }) =>
  checkout.total ? (
    <span className={checkout.quoteLoading ? "is-refreshing" : ""}>{formatMoney(checkout.total, checkout.currency)}</span>
  ) : (
    <Skeleton width={96} />
  );

// Desktop order summary (aside).
export const OrderSummary = ({ checkout }) => {
  const facts = summaryFacts(checkout);
  return (
    <section className="ck-card ck-summary" aria-label="Order summary">
      <div className="ck-summary-tour">
        {facts.image ? <img src={facts.image} alt="" width="88" height="88" /> : <span className="ck-summary-img" />}
        <div>
          <h2>{checkout.title || <Skeleton width={180} />}</h2>
          <p>{checkout.optionName}</p>
        </div>
      </div>
      <ul className="ck-facts">
        {facts.date ? <li><LuCalendar aria-hidden="true" />{facts.date}</li> : null}
        {facts.time ? <li><LuClock aria-hidden="true" />{facts.time}</li> : null}
        {facts.travellers ? <li><LuUser aria-hidden="true" />{facts.travellers}</li> : null}
        {facts.guide ? <li><LuMessageSquare aria-hidden="true" />{facts.guide}</li> : null}
      </ul>
      <Link to={checkout.tourHref} className="ck-link">Change date or travelers</Link>
      <FreeCancellation deadline={facts.deadline} />
      <hr />
      <PriceLines checkout={checkout} lines={facts.lines} />
      <hr />
      <div className="ck-total" aria-live="polite">
        <span>Total</span>
        <TotalAmount checkout={checkout} />
      </div>
      <small className="ck-note">All prices in {checkout.currency}</small>
    </section>
  );
};

// Mobile order summary under the progress bar: collapsed it shows the tour, date and total.
export const MobileOrderSummary = ({ checkout }) => {
  const facts = summaryFacts(checkout);
  return (
    <details className="ck-msummary" open>
      <summary>
        {facts.image ? <img src={facts.image} alt="" width="56" height="56" /> : <span className="ck-summary-img" />}
        <span className="ck-msummary-text">
          <strong>{shortTourName(checkout.title) || <Skeleton width={150} />}</strong>
          <small>{[facts.shortDate, checkout.trip.startTime, facts.travellers].filter(Boolean).join(" · ")}</small>
        </span>
        <span className="ck-msummary-total" aria-live="polite">
          <TotalAmount checkout={checkout} />
          <LuChevronDown aria-hidden="true" className="ck-msummary-chevron" />
        </span>
      </summary>
      <div className="ck-msummary-body">
        <div className="ck-lines">
          <div>
            <span className="ck-muted">Option</span>
            <span>{checkout.optionName}</span>
          </div>
        </div>
        <PriceLines checkout={checkout} lines={facts.lines} />
        <FreeCancellation deadline={facts.deadline} year={false} />
        <Link to={checkout.tourHref} className="ck-link ck-msummary-change">Change date or travelers</Link>
      </div>
    </details>
  );
};

export const helpWhatsappHref = (checkout) =>
  whatsappHelpHref(BRAND.whatsappHref, { title: checkout.title, date: formatTripDate(checkout.trip.travelDate), option: checkout.optionName });

// "Need help booking?" with WhatsApp (tour, date and option pre-filled) and the support contacts.
export const HelpCard = ({ checkout }) => (
  <section className="ck-card ck-helpcard" aria-label="Need help booking?">
    <h2>Need help booking?</h2>
    {BRAND.whatsappHref ? (
      <a className="ck-link" href={helpWhatsappHref(checkout)} target="_blank" rel="noreferrer">
        <LuMessageCircle aria-hidden="true" /> Chat on WhatsApp
      </a>
    ) : null}
    <p>
      <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a> · <a href={BRAND.phoneHref}>{BRAND.phone}</a>
    </p>
  </section>
);
