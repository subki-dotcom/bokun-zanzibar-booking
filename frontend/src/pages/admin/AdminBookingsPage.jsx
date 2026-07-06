import { useEffect, useState } from "react";
import { Card } from "react-bootstrap";
import { adminCancelBooking, fetchRecentBookings } from "../../api/bookingsApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import RecentBookingsTable from "../../components/dashboard/RecentBookingsTable";

const AdminBookingsPage = () => {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    try {
      const data = await fetchRecentBookings();
      setBookings(data);
    } catch (err) {
      setError(err.message || "Failed to fetch bookings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCancel = async (booking) => {
    const ok = window.confirm(`Cancel booking ${booking.bookingReference}?`);
    if (!ok) return;

    setError("");
    setNotice("");
    try {
      await adminCancelBooking(booking._id, "Cancelled from admin bookings table");
      setNotice(`${booking.bookingReference} cancelled.`);
      await load();
    } catch (err) {
      setError(err.message || "Failed to cancel booking");
    }
  };

  return (
    <>
      <h2 className="mb-1">Bookings</h2>
      <p className="section-subtitle mb-4">Central operations view for website, admin, and agent bookings.</p>
      <ErrorAlert error={error} />
      {notice ? <div className="alert alert-success">{notice}</div> : null}
      {loading ? <Loader message="Loading bookings..." /> : null}

      {!loading ? (
        <Card className="surface-card">
          <Card.Body>
            <RecentBookingsTable bookings={bookings} onCancel={handleCancel} />
          </Card.Body>
        </Card>
      ) : null}
    </>
  );
};

export default AdminBookingsPage;
