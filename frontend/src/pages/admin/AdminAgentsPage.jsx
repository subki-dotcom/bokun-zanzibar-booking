import { useEffect, useState } from "react";
import { Badge, Button, Card, Form, Table } from "react-bootstrap";
import {
  fetchAdminAgents,
  updateAdminAgentCommission,
  updateAdminAgentStatus
} from "../../api/adminApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";

const AdminAgentsPage = () => {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");

  const loadAgents = async () => {
    try {
      setError("");
      setAgents(await fetchAdminAgents());
    } catch (err) {
      setError(err.message || "Failed to load agents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAgents();
  }, []);

  const patchAgent = (updated) => {
    setAgents((prev) => prev.map((agent) => agent._id === updated._id ? updated : agent));
  };

  const handleStatusChange = async (agent, field, value) => {
    try {
      setSavingId(agent._id);
      const updated = await updateAdminAgentStatus(agent._id, {
        isActive: field === "isActive" ? value === "active" : agent.isActive,
        approvalStatus: field === "approvalStatus" ? value : agent.approvalStatus
      });
      patchAgent(updated);
    } catch (err) {
      setError(err.message || "Could not update agent status");
    } finally {
      setSavingId("");
    }
  };

  const handleCommissionSave = async (agent, value) => {
    try {
      setSavingId(agent._id);
      const updated = await updateAdminAgentCommission(agent._id, value);
      patchAgent(updated);
    } catch (err) {
      setError(err.message || "Could not update commission");
    } finally {
      setSavingId("");
    }
  };

  if (loading) {
    return <Loader message="Loading agents..." />;
  }

  return (
    <>
      <h2 className="mb-1">Agents</h2>
      <p className="section-subtitle mb-4">Manage agent access, approval status, and commission rates.</p>
      <ErrorAlert error={error} />

      <Card className="surface-card">
        <Card.Body>
          <Table responsive hover>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Contact</th>
                <th>Type</th>
                <th>Account</th>
                <th>Approval</th>
                <th>Commission %</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent._id}>
                  <td>
                    <strong>{agent.companyName}</strong>
                    <small className="d-block text-muted">{agent.fullName}</small>
                  </td>
                  <td>
                    {agent.email}
                    <small className="d-block text-muted">{agent.phone || "-"}</small>
                  </td>
                  <td>{agent.agentType || "partner"}</td>
                  <td>
                    <Badge bg={agent.isActive ? "success" : "secondary"}>
                      {agent.isActive ? "Active" : "Suspended"}
                    </Badge>
                  </td>
                  <td>{agent.approvalStatus || "approved"}</td>
                  <td>
                    <Form.Control
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      defaultValue={agent.commissionPercent ?? ""}
                      aria-label={`Commission for ${agent.companyName}`}
                      className="admin-agent-commission-input"
                      onBlur={(event) => {
                        const value = event.target.value;
                        if (value !== "" && Number(value) !== Number(agent.commissionPercent || 0)) {
                          handleCommissionSave(agent, value);
                        }
                      }}
                    />
                  </td>
                  <td className="text-end">
                    <div className="agent-table-actions">
                      <Button
                        size="sm"
                        variant={agent.isActive ? "outline-danger" : "outline-success"}
                        disabled={savingId === agent._id}
                        onClick={() => handleStatusChange(agent, "isActive", agent.isActive ? "suspended" : "active")}
                      >
                        {agent.isActive ? "Suspend" : "Activate"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-primary"
                        disabled={savingId === agent._id}
                        onClick={() => handleStatusChange(agent, "approvalStatus", agent.approvalStatus === "approved" ? "suspended" : "approved")}
                      >
                        {agent.approvalStatus === "approved" ? "Mark Suspended" : "Approve"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!agents.length ? (
                <tr>
                  <td colSpan="7" className="text-center text-muted py-4">No agents found.</td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </>
  );
};

export default AdminAgentsPage;
