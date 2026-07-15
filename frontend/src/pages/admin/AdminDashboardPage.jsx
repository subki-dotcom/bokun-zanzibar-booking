import { useEffect, useState } from "react";
import { Row, Col, Card, Table, Button, Badge } from "react-bootstrap";
import {
  fetchDashboardSummary,
  fetchConversionFunnel,
  fetchGrowthPerformance,
  fetchOperationalAlerts,
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
  const [conversionFunnel, setConversionFunnel] = useState(null);
  const [operationalAlerts, setOperationalAlerts] = useState(null);
  const [growthPerformance, setGrowthPerformance] = useState(null);

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
        const [summaryResult, bookingsResult, pendingResult, funnelResult, alertsResult, growthResult] = await Promise.all([
          fetchDashboardSummary(),
          fetchRecentBookings(),
          fetchPendingFinalizations({ limit: 12, includeProcessing: true }),
          fetchConversionFunnel().catch(() => null),
          fetchOperationalAlerts().catch(() => null),
          fetchGrowthPerformance().catch(() => null)
        ]);

        setSummary(summaryResult);
        setRecentBookings(bookingsResult);
        setPendingFinalizations(pendingResult || []);
        setConversionFunnel(funnelResult);
        setOperationalAlerts(alertsResult);
        setGrowthPerformance(growthResult);
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
          <Card className="surface-card h-100">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-baseline gap-2 mb-3">
                <h5 className="mb-0">Checkout Conversion Funnel</h5>
                <small className="text-muted">Subscribers: {conversionFunnel?.newsletterSubscribers || 0}</small>
              </div>
              <Table responsive hover className="mb-0">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th className="text-end">Customers</th>
                    <th className="text-end">Step rate</th>
                  </tr>
                </thead>
                <tbody>
                  {(conversionFunnel?.steps || []).length ? conversionFunnel.steps.map((step) => (
                    <tr key={step.key}>
                      <td>{step.label}</td>
                      <td className="text-end">{step.count}</td>
                      <td className="text-end">{step.conversionRate == null ? "-" : `${step.conversionRate}%`}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={3} className="text-center text-muted py-4">No conversion data yet.</td></tr>
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-baseline gap-2 mb-3">
                <h5 className="mb-0">Operational Alerts</h5>
                <small className="text-muted">
                  {Number(operationalAlerts?.counts?.paidPendingSupplier || 0) + Number(operationalAlerts?.counts?.failedPayments || 0) + Number(operationalAlerts?.counts?.failedEmailDeliveries || 0)} open
                </small>
              </div>
              {(operationalAlerts?.alerts || []).length ? (
                <div className="d-grid gap-2">
                  {operationalAlerts.alerts.slice(0, 5).map((alert) => (
                    <div key={alert.id} className="border rounded-3 p-2 d-flex justify-content-between gap-2">
                      <div className="min-w-0">
                        <div className="fw-semibold">{alert.title}</div>
                        <small className="text-muted d-block">{alert.description}</small>
                      </div>
                      <Badge bg={alert.severity === "danger" ? "danger" : "warning"} text={alert.severity === "danger" ? undefined : "dark"} className="align-self-start">
                        {alert.bookingReference || "Email"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : <p className="text-muted mb-0">No operational alerts right now.</p>}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Promotion Performance</h5>
              <Table responsive hover className="mb-0">
                <thead><tr><th>Campaign</th><th>Bookings</th><th className="text-end">Sales</th></tr></thead>
                <tbody>
                  {(growthPerformance?.campaigns || []).length ? growthPerformance.campaigns.map((campaign) => (
                    <tr key={campaign._id}><td>{campaign._id || "Automatic campaign"}</td><td>{campaign.bookings}</td><td className="text-end">{formatCurrency(campaign.sales || 0, "USD")}</td></tr>
                  )) : <tr><td colSpan={3} className="text-center text-muted py-4">No campaign redemptions yet.</td></tr>}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Agent Referral Performance</h5>
              <Table responsive hover className="mb-0">
                <thead><tr><th>Referral</th><th>Bookings</th><th className="text-end">Sales</th></tr></thead>
                <tbody>
                  {(growthPerformance?.referrals || []).length ? growthPerformance.referrals.map((referral) => (
                    <tr key={referral._id}><td>{referral._id}</td><td>{referral.bookings}</td><td className="text-end">{formatCurrency(referral.sales || 0, "USD")}</td></tr>
                  )) : <tr><td colSpan={3} className="text-center text-muted py-4">No attributed referrals yet.</td></tr>}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
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
