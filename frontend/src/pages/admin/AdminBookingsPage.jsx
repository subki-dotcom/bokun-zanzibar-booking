import { useEffect, useState } from "react";
import { Card } from "react-bootstrap";
import { fetchRecentBookings } from "../../api/bookingsApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import RecentBookingsTable from "../../components/dashboard/RecentBookingsTable";

const AdminBookingsPage = () => {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
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

    load();
  }, []);

  return (
    <>
      <h2 className="mb-1">Bookings</h2>
      <p className="section-subtitle mb-4">Central operations view for website, admin, and agent bookings.</p>
      <ErrorAlert error={error} />
      {loading ? <Loader message="Loading bookings..." /> : null}

      {!loading ? (
        <Card className="surface-card">
          <Card.Body>
            <RecentBookingsTable bookings={bookings} />
          </Card.Body>
        </Card>
      ) : null}
    </>
  );
};

export default AdminBookingsPage;