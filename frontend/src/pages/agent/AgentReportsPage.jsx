import { useEffect, useState } from "react";
import { Card, Table } from "react-bootstrap";
import { fetchAgentReports } from "../../api/agentApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import { formatCurrency } from "../../utils/formatters";

const AgentReportsPage = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setData(await fetchAgentReports());
      } catch (err) {
        setError(err.message || "Failed to load reports");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return <Loader message="Loading reports..." />;

  return (
    <>
      <h2 className="mb-1">Performance Reports</h2>
      <p className="section-subtitle mb-4">Monthly sales, top products, and booking status performance.</p>
      <ErrorAlert error={error} />
      <Card className="surface-card mb-4">
        <Card.Body>
          <h5>Monthly Performance</h5>
          <Table responsive hover>
            <thead><tr><th>Month</th><th>Bookings</th><th className="text-end">Sales</th></tr></thead>
            <tbody>{(data?.byMonth || []).map((row) => <tr key={row._id}><td>{row._id}</td><td>{row.bookings}</td><td className="text-end">{formatCurrency(row.sales || 0, "USD")}</td></tr>)}</tbody>
          </Table>
        </Card.Body>
      </Card>
      <Card className="surface-card">
        <Card.Body>
          <h5>Top Products</h5>
          <Table responsive hover>
            <thead><tr><th>Product</th><th>Bookings</th><th className="text-end">Sales</th></tr></thead>
            <tbody>{(data?.topProducts || []).map((row) => <tr key={row._id}><td>{row._id}</td><td>{row.bookings}</td><td className="text-end">{formatCurrency(row.sales || 0, "USD")}</td></tr>)}</tbody>
          </Table>
        </Card.Body>
      </Card>
    </>
  );
};

export default AgentReportsPage;
