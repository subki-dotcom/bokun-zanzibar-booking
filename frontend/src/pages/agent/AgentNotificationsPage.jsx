import { useEffect, useState } from "react";
import { Card } from "react-bootstrap";
import { fetchAgentNotifications } from "../../api/agentApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";

const AgentNotificationsPage = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setItems(await fetchAgentNotifications());
      } catch (err) {
        setError(err.message || "Failed to load notifications");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return <Loader message="Loading notifications..." />;

  return (
    <>
      <h2 className="mb-1">Notifications</h2>
      <p className="section-subtitle mb-4">Booking, payment, voucher, and commission updates.</p>
      <ErrorAlert error={error} />
      <div className="agent-feed-list">
        {items.map((item) => (
          <Card className="surface-card agent-feed-card" key={item._id}>
            <Card.Body>
              <strong>{String(item.action || "").replaceAll("_", " ")}</strong>
              <span>{item.reason || item.after?.bookingReference || item.metadata?.bookingReference || "System update"}</span>
              <small>{new Date(item.createdAt).toLocaleString()}</small>
            </Card.Body>
          </Card>
        ))}
        {!items.length ? <Card className="surface-card"><Card.Body className="text-muted">No notifications yet.</Card.Body></Card> : null}
      </div>
    </>
  );
};

export default AgentNotificationsPage;
