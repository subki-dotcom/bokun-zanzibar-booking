import { useEffect, useState } from "react";
import { Row, Col, Card, Table } from "react-bootstrap";
import { fetchDashboardSummary } from "../../api/adminApi";
import { fetchRecentBookings } from "../../api/bookingsApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import KpiCards from "../../components/dashboard/KpiCards";
import RecentBookingsTable from "../../components/dashboard/RecentBookingsTable";
import SalesChartPlaceholder from "../../components/dashboard/SalesChartPlaceholder";
import { formatCurrency } from "../../utils/formatters";

const AdminDashboardPage = () => {
  const [summary, setSummary] = useState(null);
  const [recentBookings, setRecentBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const [summaryResult, bookingsResult] = await Promise.all([
          fetchDashboardSummary(),
          fetchRecentBookings()
        ]);

        setSummary(summaryResult);
        setRecentBookings(bookingsResult);
      } catch (err) {
        setError(err.message || "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  if (loading) {
    return <Loader message="Loading admin dashboard..." />;
  }

  return (
    <>
      <h2 className="mb-1">Admin Dashboard</h2>
      <p className="section-subtitle mb-4">KPIs, bookings, product performance, agents, and sync monitoring.</p>

      <ErrorAlert error={error} />

      <KpiCards kpis={summary?.kpis || {}} />

      <Row className="g-4 mt-1">
        <Col lg={8}>
          <Card className="surface-card">
            <Card.Body>
              <h5>Recent Bookings</h5>
              <RecentBookingsTable bookings={recentBookings.slice(0, 10)} />
            </Card.Body>
          </Card>
        </Col>
        <Col lg={4}>
          <SalesChartPlaceholder title="Monthly Sales" />
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col lg={6}>
          <Card className="surface-card">
            <Card.Body>
              <h5 className="mb-3">Top Products</h5>
              <Table responsive hover>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Bookings</th>
                    <th className="text-end">Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.topProducts || []).map((row) => (
                    <tr key={row._id}>
                      <td>{row._id}</td>
                      <td>{row.bookings}</td>
                      <td className="text-end">{formatCurrency(row.sales || 0, "USD")}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>

        <Col lg={6}>
          <Card className="surface-card">
            <Card.Body>
              <h5 className="mb-3">Booking Source Breakdown</h5>
              <Table responsive hover>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Bookings</th>
                    <th className="text-end">Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.sourceBreakdown || []).map((row) => (
                    <tr key={row._id}>
                      <td className="text-capitalize">{row._id || "unknown"}</td>
                      <td>{row.count}</td>
                      <td className="text-end">{formatCurrency(row.sales || 0, "USD")}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </>
  );
};

export default AdminDashboardPage;