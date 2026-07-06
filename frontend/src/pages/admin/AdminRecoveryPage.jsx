import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Table } from "react-bootstrap";
import { BsArrowClockwise, BsExclamationTriangle, BsShieldCheck, BsTrash } from "react-icons/bs";
import { fetchPendingFinalizations, reconcileBookingFinalizations, retryBookingFinalization } from "../../api/adminApi";
import { adminCancelBooking } from "../../api/bookingsApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import { formatCurrency } from "../../utils/formatters";

const AdminRecoveryPage = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async ({ force = false } = {}) => {
    setError("");
    try {
      const data = await fetchPendingFinalizations({ limit: 50, includeProcessing: true, force });
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load recovery queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const paidPending = items.filter((item) => item.paymentStatus === "paid" && !item.bokunBookingId).length;
    const failed = items.filter((item) => item.finalization?.status === "failed").length;
    return { paidPending, failed, total: items.length };
  }, [items]);

  const retry = async (bookingId) => {
    setBusyId(bookingId);
    setNotice("");
    setError("");
    try {
      await retryBookingFinalization(bookingId, { force: true });
      setNotice("Retry executed. Queue refreshed.");
      await load({ force: true });
    } catch (err) {
      setError(err.message || "Retry failed");
    } finally {
      setBusyId("");
    }
  };

  const reconcile = async () => {
    setBusyId("reconcile");
    setNotice("");
    setError("");
    try {
      const result = await reconcileBookingFinalizations({ limit: 50, force: true });
      setNotice(`Reconcile complete: ${result?.summary?.confirmed || 0} confirmed, ${result?.summary?.pendingRetry || 0} pending retry.`);
      await load({ force: true });
    } catch (err) {
      setError(err.message || "Reconcile failed");
    } finally {
      setBusyId("");
    }
  };

  const cancel = async (bookingId, reference) => {
    const ok = window.confirm(`Cancel booking ${reference}? This will also request Bokun cancellation if it has a Bokun ID.`);
    if (!ok) return;

    setBusyId(bookingId);
    setNotice("");
    setError("");
    try {
      await adminCancelBooking(bookingId, "Cancelled from recovery dashboard");
      setNotice(`Booking ${reference} cancelled.`);
      await load({ force: true });
    } catch (err) {
      setError(err.message || "Cancellation failed");
    } finally {
      setBusyId("");
    }
  };

  return (
    <>
      <div className="admin-recovery-head">
        <div>
          <h2>Recovery Center</h2>
          <p className="section-subtitle">Monitor paid bookings that still need Bókun confirmation or operational intervention.</p>
        </div>
        <Button className="premium-btn text-white" onClick={reconcile} disabled={busyId === "reconcile"}>
          <BsArrowClockwise /> Reconcile Now
        </Button>
      </div>

      <ErrorAlert error={error} />
      {notice ? <div className="alert alert-success">{notice}</div> : null}
      {loading ? <Loader message="Loading recovery queue..." /> : null}

      <div className="admin-recovery-stats">
        <Card className="surface-card"><Card.Body><small>Total Queue</small><strong>{stats.total}</strong></Card.Body></Card>
        <Card className="surface-card"><Card.Body><small>Paid Pending Bókun</small><strong>{stats.paidPending}</strong></Card.Body></Card>
        <Card className="surface-card"><Card.Body><small>Failed Finalizations</small><strong>{stats.failed}</strong></Card.Body></Card>
      </div>

      {!loading ? (
        <Card className="surface-card">
          <Card.Body>
            <Table responsive hover className="align-middle">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Product</th>
                  <th>Payment</th>
                  <th>Bókun</th>
                  <th>Amount</th>
                  <th>Last Error</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.length ? items.map((item) => (
                  <tr key={item.bookingId}>
                    <td><strong>{item.bookingReference}</strong></td>
                    <td>{item.productTitle}<br /><small>{item.travelDate} {item.startTime}</small></td>
                    <td><Badge bg={item.paymentStatus === "paid" ? "success" : "warning"}>{item.paymentStatus}</Badge></td>
                    <td>
                      {item.bokunBookingId ? (
                        <Badge bg="success"><BsShieldCheck /> {item.bokunBookingId}</Badge>
                      ) : (
                        <Badge bg="warning">Pending</Badge>
                      )}
                    </td>
                    <td>{formatCurrency(item.amount || 0, item.currency || "USD")}</td>
                    <td className="admin-recovery-error">
                      {item.finalization?.lastError?.message || item.finalization?.status || "-"}
                    </td>
                    <td>
                      <div className="admin-recovery-actions">
                        <Button size="sm" variant="outline-primary" onClick={() => retry(item.bookingId)} disabled={busyId === item.bookingId}>
                          <BsArrowClockwise /> Retry
                        </Button>
                        <Button size="sm" variant="outline-danger" onClick={() => cancel(item.bookingId, item.bookingReference)} disabled={busyId === item.bookingId}>
                          <BsTrash /> Cancel
                        </Button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan="7" className="text-center py-4">
                      <BsExclamationTriangle /> No pending recovery items.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      ) : null}
    </>
  );
};

export default AdminRecoveryPage;
