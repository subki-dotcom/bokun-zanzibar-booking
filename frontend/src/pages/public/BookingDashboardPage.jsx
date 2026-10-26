import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LuRefreshCw } from "react-icons/lu";
import { fetchMyBooking, openWithPaymentKey } from "../../api/myBookingApi";
import useBookingSession, { refreshBookingSession } from "../../components/myBooking/useBookingSession";
import useMediaQuery from "../../hooks/useMediaQuery";
import DashboardSkeleton from "../../components/myBooking/DashboardSkeleton";
import Toast from "../../components/myBooking/Toast";
import CancelDialog from "../../components/myBooking/CancelDialog";
import ChangeDialog from "../../components/myBooking/ChangeDialog";
import ContactDetailsDialog from "../../components/myBooking/ContactDetailsDialog";
import {
  BookingHero,
  DayTimeline,
  ETicketCard,
  HelpCard,
  KeyFacts,
  ManageBooking,
  PickupCard,
  ReceiptCard
} from "../../components/myBooking/BookingSections";
import { whatsappPickupHref, whatsappTripHref } from "../../components/myBooking/myBookingData";
import { SITE } from "../../config/site";
import { trackAnalyticsEvent } from "../../utils/analytics";
import "../../components/myBooking/myBooking.css";

const lookupHref = (reference) => `/my-booking?ref=${encodeURIComponent(reference)}`;

const RequestNotes = ({ data }) => {
  if (data.status.key === "cancelled") {
    return (
      <div className="mb-banner-note is-danger" role="note">
        <div>
          <strong>This booking is cancelled.</strong>
          {data.cancellation?.refunded > 0 ? ` A refund of ${data.receipt.currency} ${data.cancellation.refunded.toFixed(2)} was sent to your original payment method.` : " Any refund is shown in your receipt."}
        </div>
      </div>
    );
  }
  if (!data.requests.length) return null;
  const labels = { reschedule: "date change", change_travelers: "traveler change", cancel_booking: "cancellation", combined_change: "change" };
  return (
    <div className="mb-banner-note" role="note">
      <div>
        <strong>We&apos;re reviewing your {data.requests.map((request) => labels[request.type] || "request").join(" and ")} request.</strong>
        {" "}We&apos;ll email you as soon as it&apos;s confirmed – usually within 24 hours. Reference {data.requests.map((request) => request.reference).join(", ")}.
      </div>
    </div>
  );
};

// /my-booking/:reference (mockups "MyBooking" and "MyBookingMobile"). Nothing renders without a session for this
// booking: no session → the lookup form with the reference filled in.
const BookingDashboardPage = () => {
  const { reference: rawReference = "" } = useParams();
  const reference = rawReference.toUpperCase();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const paymentKey = params.get("key") || "";
  const session = useBookingSession({ load: !paymentKey });
  const isPhone = useMediaQuery("(max-width: 767px)");
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState("");
  const [keyFailed, setKeyFailed] = useState(false);
  const toastTimer = useRef(0);
  const viewed = useRef(false);

  // From the confirmation page: the payment key signs this device in, then leaves the address bar.
  useEffect(() => {
    if (!paymentKey) return;
    let active = true;
    openWithPaymentKey(reference, paymentKey)
      .then(() => refreshBookingSession())
      .catch(() => active && setKeyFailed(true))
      .finally(() => active && navigate(`/my-booking/${encodeURIComponent(reference)}`, { replace: true }));
    return () => {
      active = false;
    };
  }, [paymentKey, reference, navigate]);

  const load = useCallback(async () => {
    setState((current) => (current === "ready" ? "ready" : "loading"));
    try {
      const value = await fetchMyBooking(reference);
      setData(value);
      setState("ready");
      if (!viewed.current) {
        viewed.current = true;
        trackAnalyticsEvent("view_booking");
      }
    } catch (error) {
      setState(error.status === 404 ? "denied" : "error");
    }
  }, [reference]);

  const signedInHere = session.status === "signed_in" && session.reference === reference;
  useEffect(() => {
    if (signedInHere && !paymentKey) load();
  }, [signedInHere, paymentKey, load]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  }, []);

  const finishRequest = (message) => {
    setDialog(null);
    showToast(message);
    load();
  };

  if (!paymentKey && (session.status === "signed_out" || (session.status === "signed_in" && !signedInHere) || keyFailed || state === "denied")) {
    return <Navigate to={lookupHref(reference)} replace />;
  }

  if (state === "error") {
    const href = whatsappTripHref(SITE.whatsappHref, reference);
    return (
      <div className="mb">
        <div className="mb-container">
          <div className="mb-card mb-error" role="alert">
            <h1>We couldn&apos;t load your booking</h1>
            <p>This is usually a slow connection. Please try again – your booking is safe.</p>
            <div className="mb-error-actions">
              <button type="button" className="mb-btn mb-btn-primary" onClick={load}>
                <LuRefreshCw aria-hidden="true" /> Try again
              </button>
              {href ? <a className="mb-btn mb-btn-outline" href={href} target="_blank" rel="noreferrer">Ask us on WhatsApp</a> : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data || state !== "ready") {
    return (
      <div className="mb" aria-busy="true">
        <p className="mb-visually-hidden" role="status">Loading your booking…</p>
        <DashboardSkeleton />
      </div>
    );
  }

  const open = (name) => () => setDialog(name);
  const changePickup = () => {
    const href = whatsappPickupHref(SITE.whatsappHref, data.reference);
    if (href) window.open(href, "_blank", "noopener,noreferrer");
  };

  const ticket = (
    <ETicketCard
      data={data}
      onCopied={() => showToast("Copied")}
      onToast={showToast}
      onShowContact={open("contact")}
    />
  );
  const manage = <ManageBooking data={data} onChangeDate={open("reschedule")} onChangeTravelers={open("change_travelers")} onCancel={open("cancel")} />;

  return (
    <div className="mb">
      <BookingHero data={data} />
      <div className="mb-container">
        {isPhone ? (
          <div className="mb-layout">
            {ticket}
            <RequestNotes data={data} />
            <DayTimeline data={data} />
            <PickupCard data={data} onChangePickup={changePickup} />
            {manage}
            <ReceiptCard data={data} />
            <HelpCard data={data} />
          </div>
        ) : (
          <div className="mb-layout">
            <div className="mb-main">
              <KeyFacts data={data} />
              <RequestNotes data={data} />
              <DayTimeline data={data} />
              <PickupCard data={data} onChangePickup={changePickup} />
              {manage}
            </div>
            <aside className="mb-side" aria-label="Ticket and receipt">
              {ticket}
              <ReceiptCard data={data} />
              <HelpCard data={data} />
            </aside>
          </div>
        )}
      </div>

      {dialog === "cancel" ? <CancelDialog data={data} onClose={() => setDialog(null)} onDone={finishRequest} onChangeDate={() => setDialog("reschedule")} /> : null}
      {dialog === "reschedule" || dialog === "change_travelers" ? (
        <ChangeDialog type={dialog} data={data} onClose={() => setDialog(null)} onDone={finishRequest} />
      ) : null}
      {dialog === "contact" ? <ContactDetailsDialog data={data} onClose={() => setDialog(null)} /> : null}
      <Toast message={toast} />
    </div>
  );
};

export default BookingDashboardPage;
