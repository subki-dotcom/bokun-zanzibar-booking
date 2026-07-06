import { Button, Card } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { acceptAgentTerms } from "../../api/agentApi";
import useAuth from "../../hooks/useAuth";

const AgentTermsPage = () => {
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();

  const accept = async () => {
    await acceptAgentTerms("2026-07");
    await refreshProfile();
    navigate("/agent", { replace: true });
  };

  return (
    <Card className="surface-card agent-status-card">
      <Card.Body>
        <span className="voucher-kicker">Agent Agreement</span>
        <h2>Riser Agent Terms</h2>
        <p>Before creating bookings, please confirm you understand these rules.</p>
        <ul className="agent-terms-list">
          <li>Bookings must be created with accurate customer information.</li>
          <li>Payment must be confirmed before Bokun confirmation is treated as final.</li>
          <li>Commission is paid only for eligible paid bookings.</li>
          <li>Voucher and customer details must not be shared with unauthorized people.</li>
          <li>Cancellation requests are reviewed by Riser admin.</li>
        </ul>
        <Button className="agent-primary-btn" onClick={accept}>Accept Terms</Button>
      </Card.Body>
    </Card>
  );
};

export default AgentTermsPage;
