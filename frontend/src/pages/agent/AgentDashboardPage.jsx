import { useEffect, useState } from "react";
import { Row, Col, Card, Table } from "react-bootstrap";
import dayjs from "dayjs";
import { fetchAgentDashboard, fetchAgentStatement } from "../../api/agentApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import CommissionSummaryCard from "../../components/agents/CommissionSummaryCard";
import AgentBookingTable from "../../components/agents/AgentBookingTable";
import { formatCurrency } from "../../utils/formatters";

const AgentDashboardPage = () => {
  const [dashboard, setDashboard] = useState(null);
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const month = dayjs().format("YYYY-MM");
        const [dashboardResult, statementResult] = await Promise.all([
          fetchAgentDashboard(),
          fetchAgentStatement(month)
        ]);

        setDashboard(dashboardResult);
        setStatement(statementResult);
      } catch (err) {
        setError(err.message || "Failed to load agent dashboard");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  if (loading) {
    return <Loader message="Loading agent dashboard..." />;
  }

  return (
    <>
      <h2 className="mb-1">Agent Portal</h2>
      <p className="section-subtitle mb-4">Your bookings, commission summary, and monthly statement.</p>
      <ErrorAlert error={error} />

      <Row className="g-4">
        <Col lg={4}>
          <CommissionSummaryCard summary={dashboard?.commissionSummary || []} />
        </Col>
        <Col lg={8}>
          <Card className="surface-card">
            <Card.Body>
              <h5 className="mb-3">Current Month Statement ({statement?.payoutMonth})</h5>
              <div className="d-flex gap-4 mb-3">
                <div>
                  <small className="text-muted d-block">Total Net Sales</small>
                  <strong>{formatCurrency(statement?.totalNet || 0, "USD")}</strong>
                </div>
                <div>
                  <small className="text-muted d-block">Total Commission</small>
                  <strong>{formatCurrency(statement?.totalCommission || 0, "USD")}</strong>
                </div>
              </div>
              <Table responsive hover>
                <thead>
                  <tr>
                    <th>Booking Ref</th>
                    <th>Percent</th>
                    <th className="text-end">Commission</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(statement?.records || []).map((row) => (
                    <tr key={row._id}>
                      <td>{row.bookingReference}</td>
                      <td>{row.commissionPercent}%</td>
                      <td className="text-end">{formatCurrency(row.commissionAmount, "USD")}</td>
                      <td>{row.payoutStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Card className="surface-card mt-4">
        <Card.Body>
          <h5>Your Recent Bookings</h5>
          <AgentBookingTable bookings={dashboard?.bookings || []} />
        </Card.Body>
      </Card>
    </>
  );
};

export default AgentDashboardPage;