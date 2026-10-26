import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { openBookingLink } from "../../api/myBookingApi";
import { refreshBookingSession } from "../../components/myBooking/useBookingSession";
import DashboardSkeleton from "../../components/myBooking/DashboardSkeleton";
import "../../components/myBooking/myBooking.css";

// /my-booking/open#token=… (the emailed link): the token is read from the fragment, removed from the address bar
// and history, and exchanged once for the session cookie. Then the booking opens.
const MyBookingOpenPage = () => {
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") || "";
    window.history.replaceState(null, "", "/my-booking/open");
    if (!token) {
      navigate("/my-booking?expired=1", { replace: true });
      return;
    }
    openBookingLink(token)
      .then(async ({ reference }) => {
        await refreshBookingSession();
        navigate(`/my-booking/${encodeURIComponent(reference)}`, { replace: true });
      })
      .catch(() => navigate("/my-booking?expired=1", { replace: true }));
  }, [navigate]);

  return (
    <div className="mb" aria-busy="true">
      <p className="mb-visually-hidden" role="status">Opening your booking…</p>
      <DashboardSkeleton />
    </div>
  );
};

export default MyBookingOpenPage;
