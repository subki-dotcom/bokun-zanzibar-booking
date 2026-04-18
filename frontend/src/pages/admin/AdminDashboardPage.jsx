import { useEffect, useState } from "react";
import { Row, Col, Card, Table, Button, Badge } from "react-bootstrap";
import {
  fetchDashboardSummary,
  fetchPendingFinalizations,
  reconcileBookingFinalizations,
  retryBookingFinalization
} from "../../api/adminApi";
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
  const [pendingFinalizations, setPendingFinalizations] = useState([]);
  const [finalizationError, setFinalizationError] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [retryingBookingId, setRetryingBookingId] = useState("");

  const loadPendingFinalizationData = async () => {
    try {
      setFinalizationError("");
      const pending = await fetchPendingFinalizations({ limit: 12, includeProcessing: true });
      setPendingFinalizations(pending || []);
    } catch (err) {
      setFinalizationError(err.message || "Failed to load finalization recovery data");
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const [summaryResult, bookingsResult, pendingResult] = await Promise.all([
          fetchDashboardSummary(),
          fetchRecentBookings(),
          fetchPendingFinalizations({ limit: 12, includeProcessing: true })
        ]);

        setSummary(summaryResult);
        setRecentBookings(bookingsResult);
        setPendingFinalizations(pendingResult || []);
      } catch (err) {
        setError(err.message || "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const handleReconcileNow = async () => {
    setReconciling(true);
    setFinalizationError("");

    try {
      await reconcileBookingFinalizations({ limit: 20, force: false });
      await loadPendingFinalizationData();
    } catch (err) {
      setFinalizationError(err.message || "Reconciliation failed");
    } finally {
      setReconciling(false);
    }
  };

  const handleRetryBooking = async (bookingId) => {
    setRetryingBookingId(String(bookingId || ""));
    setFinalizationError("");

    try {
      await retryBookingFinalization(bookingId, { force: false });
      await loadPendingFinalizationData();
    } catch (err) {
      setFinalizationError(err.message || "Retry failed");
    } finally {
      setRetryingBookingId("");
    }
  };

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

      <Row className="g-4 mt-1">
        <Col lg={12}>
          <Card className="surface-card">
            <Card.Body>
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                <div>
                  <h5 className="mb-1">Booking Finalization Recovery</h5>
                  <p className="mb-0 text-muted">
                    Paid bookings waiting for Bokun confirmation can be retried here.
                  </p>
                </div>
                <Button variant="dark" onClick={handleReconcileNow} disabled={reconciling}>
                  {reconciling ? "Reconciling..." : "Reconcile now"}
                </Button>
              </div>

              <ErrorAlert error={finalizationError} />

              <Table responsive hover>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Product</th>
                    <th>Finalization</th>
                    <th>Next Retry</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingFinalizations.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center text-muted py-4">
                        No paid bookings waiting for Bokun finalization.
                      </td>
                    </tr>
                  ) : (
                    pendingFinalizations.map((row) => (
                      <tr key={row.bookingId}>
                        <td>{row.bookingReference}</td>
                        <td>{row.productTitle || "-"}</td>
                        <td>
                          <Badge bg={row.finalization?.status === "processing" ? "warning" : "secondary"}>
                            {row.finalization?.status || "idle"}
                          </Badge>
                        </td>
                        <td>{row.finalization?.nextRetryAt || "-"}</td>
                        <td className="text-end">
                          <Button
                            size="sm"
                            variant="outline-primary"
                            disabled={retryingBookingId === String(row.bookingId)}
                            onClick={() => handleRetryBooking(row.bookingId)}
                          >
                            {retryingBookingId === String(row.bookingId) ? "Retrying..." : "Retry now"}
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
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
