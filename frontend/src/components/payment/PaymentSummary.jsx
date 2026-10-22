import { LuCheck } from "react-icons/lu";
import { formatDeadline, formatMoney, formatTripDate, travellersText } from "../checkout/checkoutData";
import ReferenceBox from "./ReferenceBox";
import { tripLine } from "./paymentData";

const Skeleton = ({ width = 120 }) => <span className="ck-skeleton" style={{ width }} aria-hidden="true" />;

const TourHead = ({ data, size = 72, line = true }) => (
  <div className="pf-tour">
    {data?.tour?.image ? (
      <img src={data.tour.image} alt="" width={size} height={size} style={{ width: size, height: size }} />
    ) : (
      <span className="pf-tour-img" style={{ width: size, height: size }} />
    )}
    <div>
      <strong>{data?.tour?.title || <Skeleton width={160} />}</strong>
      <small>{data ? (line ? tripLine(data) : data.tour?.option) : <Skeleton width={120} />}</small>
    </div>
  </div>
);

const FreeCancellation = ({ deadline, year = false }) => {
  if (!deadline) return null;
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime()) || date.getTime() < Date.now()) return null;
  return (
    <p className="ck-free">
      <LuCheck aria-hidden="true" />
      <span>
        <strong>Free cancellation</strong> until {formatDeadline(date, { year })}
      </span>
    </p>
  );
};

const PAY_STEPS = [
  { id: "saved", title: "Booking details saved", detail: "Date, time and pickup recorded", state: "done" },
  { id: "payment", title: "Payment", detail: "In progress", state: "current" },
  { id: "confirmation", title: "Confirmation", detail: "Ticket sent to your email", state: "next" }
];

// Aside on the Pay page: tour, reference, progress, total and free cancellation.
export const PaySummary = ({ data }) => (
  <section className="ck-card pf-summary" aria-label="Booking summary">
    <TourHead data={data} />
    <ReferenceBox reference={data?.bookingReference || ""} />
    <ol className="pf-steps">
      {PAY_STEPS.map((step) => (
        <li key={step.id} className={`is-${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
          <span className="pf-step-dot" aria-hidden="true">{step.state === "done" ? <LuCheck /> : null}</span>
          <span>
            <strong>{step.title}</strong>
            <small>{step.detail}</small>
          </span>
        </li>
      ))}
    </ol>
    <hr />
    <div className="pf-total">
      <span>Total</span>
      <strong>{data ? formatMoney(data.amount, data.currency) : <Skeleton width={90} />}</strong>
    </div>
    <FreeCancellation deadline={data?.cancellationDeadline} />
  </section>
);

// Aside on the payment problem page: the trip, reference, "Awaiting payment" and the amount due.
export const ProblemSummary = ({ data, statusLabel = "Awaiting payment" }) => (
  <section className="ck-card pf-summary" aria-label="Booking summary">
    <TourHead data={data} line={false} />
    <dl className="pf-rows">
      <div><dt>Date</dt><dd>{data ? formatTripDate(data.date) : <Skeleton width={110} />}</dd></div>
      {data?.time ? <div><dt>Time</dt><dd>{data.time}</dd></div> : null}
      <div><dt>Travelers</dt><dd>{data ? travellersText(data.travelers) : <Skeleton width={70} />}</dd></div>
    </dl>
    <ReferenceBox reference={data?.bookingReference || ""} />
    <div className="pf-status-row">
      <span>Status</span>
      <span className="pf-status-pill">{statusLabel}</span>
    </div>
    <hr />
    <div className="pf-total">
      <span>Amount due</span>
      <strong>{data ? formatMoney(data.amount, data.currency) : <Skeleton width={90} />}</strong>
    </div>
  </section>
);

// Phones: one compact card above the main card.
export const CompactSummary = ({ data }) => (
  <section className="ck-card pf-compact" aria-label="Booking summary">
    <div className="pf-compact-row">
      <TourHead data={data} size={52} />
      <strong className="pf-compact-amount">{data ? formatMoney(data.amount, data.currency) : <Skeleton width={70} />}</strong>
    </div>
    <ReferenceBox reference={data?.bookingReference || ""} />
  </section>
);
