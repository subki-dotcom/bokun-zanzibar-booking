import { useEffect, useState } from "react";
import { Card } from "react-bootstrap";
import { fetchAgentActivity } from "../../api/agentApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";

const AgentActivityPage = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setItems(await fetchAgentActivity());
      } catch (err) {
        setError(err.message || "Failed to load activity");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return <Loader message="Loading activity..." />;

  return (
    <>
      <h2 className="mb-1">Activity Log</h2>
      <p className="section-subtitle mb-4">A timeline of booking and account actions linked to your agent account.</p>
      <ErrorAlert error={error} />
      <div className="agent-feed-list">
        {items.map((item) => (
          <Card className="surface-card agent-feed-card" key={item._id}>
            <Card.Body>
              <strong>{String(item.action || "").replaceAll("_", " ")}</strong>
              <span>{item.reason || item.entityType}</span>
              <small>{new Date(item.createdAt).toLocaleString()}</small>
            </Card.Body>
          </Card>
        ))}
        {!items.length ? <Card className="surface-card"><Card.Body className="text-muted">No activity yet.</Card.Body></Card> : null}
      </div>
    </>
  );
};

export default AgentActivityPage;
