import { useEffect, useState } from "react";
import { Badge, Button, Card, Col, Row, Table } from "react-bootstrap";
import { fetchAgentCommissions, fetchAgentPayoutRequests, requestAgentPayout } from "../../api/agentApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import { formatCurrency, statusBadgeVariant } from "../../utils/formatters";

const SummaryCard = ({ label, value }) => (
  <Card className="surface-card agent-metric-card">
    <Card.Body>
      <small>{label}</small>
      <strong>{value}</strong>
    </Card.Body>
  </Card>
);

const AgentCommissionPage = () => {
  const [data, setData] = useState(null);
  const [payoutRequests, setPayoutRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setError("");
      const [commissionData, requests] = await Promise.all([
        fetchAgentCommissions(),
        fetchAgentPayoutRequests()
      ]);
      setData(commissionData);
      setPayoutRequests(requests || []);
    } catch (err) {
      setError(err.message || "Failed to load commissions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <Loader message="Loading commission statement..." />;

  const summary = data?.summary || {};
  const unpaidAmount = Number(summary.unpaidCommission || 0);

  const handlePayoutRequest = async () => {
    try {
      setRequesting(true);
      setNotice("");
      setError("");
      await requestAgentPayout({
        amount: unpaidAmount,
        currency: "USD",
        notes: "Agent requested payout from commission page"
      });
      setNotice("Payout request submitted for admin review.");
      await load();
    } catch (err) {
      setError(err.message || "Could not request payout");
    } finally {
      setRequesting(false);
    }
  };

  return (
    <>
      <div className="agent-page-head">
        <div>
          <h2 className="mb-1">Commission / Statement</h2>
          <p className="section-subtitle mb-0">Track sales, commission, and payout status.</p>
        </div>
        <Button className="agent-primary-btn" disabled={requesting || unpaidAmount <= 0} onClick={handlePayoutRequest}>
          {requesting ? "Requesting..." : "Request Payout"}
        </Button>
      </div>
      <ErrorAlert error={error} />
      {notice ? <div className="alert alert-success">{notice}</div> : null}
      <Row className="g-3 mb-4">
        <Col sm={6} xl={2}><SummaryCard label="Bookings" value={summary.totalBookings || 0} /></Col>
        <Col sm={6} xl={2}><SummaryCard label="Total Sales" value={formatCurrency(summary.totalSales || 0, "USD")} /></Col>
        <Col sm={6} xl={2}><SummaryCard label="Commission" value={formatCurrency(summary.totalCommission || 0, "USD")} /></Col>
        <Col sm={6} xl={2}><SummaryCard label="Paid" value={formatCurrency(summary.paidCommission || 0, "USD")} /></Col>
        <Col sm={6} xl={2}><SummaryCard label="Unpaid" value={formatCurrency(summary.unpaidCommission || 0, "USD")} /></Col>
        <Col sm={6} xl={2}><SummaryCard label="This Month" value={formatCurrency(summary.currentMonthCommission || 0, "USD")} /></Col>
      </Row>

      <Card className="surface-card mb-4">
        <Card.Body>
          <h5>Monthly Statements</h5>
          <Table responsive hover>
            <thead>
              <tr>
                <th>Month</th><th>Bookings</th><th>Total Sales</th><th>Commission</th><th>Paid</th><th>Balance</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(data?.statements || []).map((row) => (
                <tr key={row.month}>
                  <td>{row.month}</td><td>{row.bookingCount}</td><td>{formatCurrency(row.totalSales, "USD")}</td>
                  <td>{formatCurrency(row.totalCommission, "USD")}</td><td>{formatCurrency(row.paidAmount, "USD")}</td>
                  <td>{formatCurrency(row.balance, "USD")}</td><td><Badge bg={statusBadgeVariant(row.status)}>{row.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      <Card className="surface-card mb-4">
        <Card.Body>
          <h5>Payout Requests</h5>
          <Table responsive hover>
            <thead>
              <tr>
                <th>Requested</th><th>Amount</th><th>Status</th><th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {payoutRequests.map((row) => (
                <tr key={row._id}>
                  <td>{new Date(row.requestedAt || row.createdAt).toLocaleString()}</td>
                  <td>{formatCurrency(row.amount || 0, row.currency || "USD")}</td>
                  <td><Badge bg={statusBadgeVariant(row.status)}>{row.status}</Badge></td>
                  <td>{row.notes || "-"}</td>
                </tr>
              ))}
              {!payoutRequests.length ? (
                <tr><td colSpan="4" className="text-center text-muted py-3">No payout requests yet.</td></tr>
              ) : null}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      <Card className="surface-card">
        <Card.Body>
          <h5>Commission Per Booking</h5>
          <Table responsive hover>
            <thead>
              <tr>
                <th>Booking</th><th>Travel Month</th><th>Sale</th><th>Rate</th><th>Commission</th><th>Payout</th>
              </tr>
            </thead>
            <tbody>
              {(data?.records || []).map((row) => (
                <tr key={row._id}>
                  <td>{row.bookingReference}</td><td>{row.payoutMonth}</td><td>{formatCurrency(row.netAmount, "USD")}</td>
                  <td>{row.commissionPercent}%</td><td>{formatCurrency(row.commissionAmount, "USD")}</td>
                  <td><Badge bg={statusBadgeVariant(row.payoutStatus)}>{row.payoutStatus}</Badge></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </>
  );
};

export default AgentCommissionPage;
