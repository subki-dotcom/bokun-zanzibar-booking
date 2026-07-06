import { Button, Card } from "react-bootstrap";
import { Link } from "react-router-dom";
import useAuth from "../../hooks/useAuth";

const AgentPendingApprovalPage = () => {
  const { user, logout } = useAuth();
  const suspended = user?.approvalStatus === "suspended" || user?.accountStatus === "suspended";

  return (
    <Card className="surface-card agent-status-card">
      <Card.Body>
        <span className="voucher-kicker">{suspended ? "Account Suspended" : "Pending Approval"}</span>
        <h2>{suspended ? "Your agent account is suspended" : "Your agent account is waiting for approval"}</h2>
        <p>
          {suspended
            ? "Please contact Riser Tours & Safaris support to review your account."
            : "Riser admin must approve your account before you can access the booking desk."}
        </p>
        <div className="d-flex flex-wrap gap-2">
          <Button as={Link} to="/agent/support" className="agent-primary-btn">Contact Support</Button>
          <Button variant="outline-secondary" onClick={logout}>Logout</Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default AgentPendingApprovalPage;
