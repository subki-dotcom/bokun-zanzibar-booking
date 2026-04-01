import { useEffect, useState } from "react";
import { Card } from "react-bootstrap";
import { fetchAgentBookings } from "../../api/agentApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import AgentBookingTable from "../../components/agents/AgentBookingTable";

const AgentBookingsPage = () => {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchAgentBookings();
        setBookings(data);
      } catch (err) {
        setError(err.message || "Failed to load agent bookings");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  return (
    <>
      <h2 className="mb-1">My Bookings</h2>
      <p className="section-subtitle mb-4">All bookings created from your agent portal.</p>

      <ErrorAlert error={error} />
      {loading ? <Loader message="Loading bookings..." /> : null}

      {!loading ? (
        <Card className="surface-card">
          <Card.Body>
            <AgentBookingTable bookings={bookings} />
          </Card.Body>
        </Card>
      ) : null}
    </>
  );
};

export default AgentBookingsPage;