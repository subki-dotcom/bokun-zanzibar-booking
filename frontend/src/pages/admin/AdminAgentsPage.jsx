import { useEffect, useState } from "react";
import { confirmAction } from "../../components/admin/ui/feedback";
import { Form } from "react-bootstrap";
import { BsPeople } from "react-icons/bs";
import {
  fetchAdminAgents,
  updateAdminAgentCommission,
  updateAdminAgentStatus
} from "../../api/adminApi";
import { AdminPage, DataTable, EmptyState, ErrorState, PageHeader, SectionCard, StatusBadge, Truncate } from "../../components/admin/ui";
import { formatLabel } from "../../utils/formatLabel";

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

  const columns = [
    {
      key: "agent",
      header: "Agent",
      render: (agent) => (
        <>
          <strong className="d-block">{agent.companyName}</strong>
          <small className="text-muted">{agent.fullName}</small>
        </>
      )
    },
    {
      key: "contact",
      header: "Contact",
      render: (agent) => (
        <>
          <Truncate value={agent.email} max={30} />
          <small className="d-block text-muted">{agent.phone || "—"}</small>
        </>
      )
    },
    { key: "type", header: "Type", render: (agent) => formatLabel(agent.agentType || "partner") },
    { key: "account", header: "Account", render: (agent) => <StatusBadge value={agent.isActive ? "active" : "inactive"} label={agent.isActive ? "Active" : "Suspended"} /> },
    { key: "approval", header: "Approval", render: (agent) => <StatusBadge value={agent.approvalStatus || "approved"} /> },
    {
      key: "commission",
      header: "Commission %",
      render: (agent) => (
        <Form.Control
          type="number"
          min="0"
          max="100"
          step="0.01"
          size="sm"
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
      )
    },
  ];

  return (
    <AdminPage>
      <PageHeader
        eyebrow="Operations"
        title="Assignments"
        description="Agents and B2B partners: who can sell, their approval and their commission."
      />
      {error && agents.length ? <ErrorState title="Something went wrong" message={error} /> : null}
      <SectionCard title="Agents" description={loading ? "" : `${agents.length} agent${agents.length === 1 ? "" : "s"}`}>
        <DataTable
          columns={columns}
          rows={agents}
          rowKey={(agent) => agent._id}
          rowActions={(agent) => [
            {
              label: agent.isActive ? "Suspend account" : "Activate account",
              danger: agent.isActive,
              disabled: savingId === agent._id,
              onClick: async () => {
                if (agent.isActive && !(await confirmAction({ title: `Suspend ${agent.companyName}?`, message: "They will not be able to sign in.", confirmLabel: "Suspend" }))) return;
                handleStatusChange(agent, "isActive", agent.isActive ? "suspended" : "active");
              }
            },
            {
              label: agent.approvalStatus === "approved" ? "Mark as suspended" : "Approve",
              disabled: savingId === agent._id,
              onClick: () => handleStatusChange(agent, "approvalStatus", agent.approvalStatus === "approved" ? "suspended" : "approved")
            }
          ]}
          loading={loading}
          error={!agents.length ? error : ""}
          onRetry={() => {
            setLoading(true);
            loadAgents();
          }}
          empty={<EmptyState icon={BsPeople} title="No agents yet" message="Agents appear here after they register in the agent portal." />}
          caption="Agents"
        />
      </SectionCard>
    </AdminPage>
  );
};

export default AdminAgentsPage;
