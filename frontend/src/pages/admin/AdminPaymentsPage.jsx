import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import {
  BsArrowClockwise,
  BsCheck2Circle,
  BsCloudCheck,
  BsCreditCard2Front,
  BsReceipt,
  BsShieldCheck
} from "react-icons/bs";
import {
  fetchPaymentReconciliation,
  markPaymentReviewed,
  recheckPesapalStatus,
  retryBokunFromPaymentReconciliation,
  syncPaymentInvoice
} from "../../api/adminApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import { formatCurrency, formatDate } from "../../utils/formatters";

const statusVariant = (status = "") => {
  const normalized = String(status || "").toLowerCase();
  if (["paid", "confirmed", "completed"].includes(normalized)) return "success";
  if (["pending", "processing", "missing", "unknown"].includes(normalized)) return "warning";
  if (["failed", "cancelled", "refunded"].includes(normalized)) return "danger";
  return "secondary";
};

const formatReconciliationError = (error = {}) => {
  if (error.code !== "PESAPAL_VERIFIED_AMOUNT_MISMATCH") {
    return error.message || "Action failed";
  }

  const details = error.details || {};
  const expectedAmount = Number(details.expectedAmount || 0);
  const verifiedAmount = Number(details.verifiedAmount || 0);
  const expectedCurrency = details.expectedCurrency || details.verifiedCurrency || "USD";
  const verifiedCurrency = details.verifiedCurrency || expectedCurrency;

  return `Payment was not credited and no Bokun booking was created. Expected ${formatCurrency(
    expectedAmount,
    expectedCurrency
  )}, but Pesapal verified ${formatCurrency(verifiedAmount, verifiedCurrency)}.`;
};

const AdminPaymentsPage = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showNeedsAttention, setShowNeedsAttention] = useState(false);

  const load = async () => {
    setError("");
    try {
      const data = await fetchPaymentReconciliation({ limit: 150 });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load payment reconciliation");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const paidGateway = rows.filter((row) => row.localPaymentStatus === "paid").length;
    const invoiceMismatch = rows.filter(
      (row) => row.localPaymentStatus === "paid" && (row.invoiceStatus !== "paid" || Number(row.paidAmount || 0) <= 0)
    ).length;
    const supplierPending = rows.filter((row) => row.localPaymentStatus === "paid" && row.bokunSupplierStatus === "pending").length;
    const reviewed = rows.filter((row) => row.reviewed).length;
    return { paidGateway, invoiceMismatch, supplierPending, reviewed, total: rows.length };
  }, [rows]);

  const visibleRows = useMemo(
    () => (showNeedsAttention ? rows.filter((row) => row.needsAttention) : rows),
    [rows, showNeedsAttention]
  );

  const runAction = async ({ key, successMessage, action }) => {
    setBusyKey(key);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await load();
    } catch (err) {
      setError(formatReconciliationError(err));
    } finally {
      setBusyKey("");
    }
  };

  return (
    <div className="admin-payments-page">
      <div className="admin-recovery-head">
        <div>
          <h2>Payment Reconciliation</h2>
          <p className="section-subtitle">
            Compare Pesapal, local payment records, invoices, and Bókun supplier confirmation.
          </p>
        </div>
        <Button className="premium-btn text-white" onClick={load} disabled={loading || Boolean(busyKey)}>
          <BsArrowClockwise /> Refresh
        </Button>
      </div>

      <ErrorAlert error={error} />
      {notice ? <div className="alert alert-success">{notice}</div> : null}
      {loading ? <Loader message="Loading payment reconciliation..." /> : null}

      <Row className="g-3 admin-payment-stat-grid">
        <Col md={3}>
          <Card className="surface-card"><Card.Body><small>Total Rows</small><strong>{stats.total}</strong></Card.Body></Card>
        </Col>
        <Col md={3}>
          <Card className="surface-card"><Card.Body><small>Verified Paid</small><strong>{stats.paidGateway}</strong></Card.Body></Card>
        </Col>
        <Col md={3}>
          <Card className="surface-card"><Card.Body><small>Invoice Needs Sync</small><strong>{stats.invoiceMismatch}</strong></Card.Body></Card>
        </Col>
        <Col md={3}>
          <Card className="surface-card"><Card.Body><small>Supplier Pending</small><strong>{stats.supplierPending}</strong></Card.Body></Card>
        </Col>
      </Row>

      <Card className="surface-card mt-4">
        <Card.Body>
          <div className="admin-payment-toolbar">
            <div>
              <h5>Gateway and Invoice Status</h5>
              <span>{stats.reviewed} reviewed records</span>
            </div>
            <Form.Check
              type="switch"
              id="needs-attention-filter"
              label="Needs attention only"
              checked={showNeedsAttention}
              onChange={(event) => setShowNeedsAttention(event.target.checked)}
            />
          </div>

          <Table responsive hover className="align-middle admin-payment-table">
            <thead>
              <tr>
                <th>Booking</th>
                <th>Pesapal</th>
                <th>Local Payment</th>
                <th>Invoice</th>
                <th>Bókun Supplier</th>
                <th>Expected</th>
                <th>Pesapal Amount</th>
                <th>Paid</th>
                <th>Last Verified</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length ? (
                visibleRows.map((row) => {
                  const busyPrefix = `${row.bookingReference}:`;
                  const isBusy = busyKey.startsWith(busyPrefix);
                  const canRecheckPesapal = String(row.provider || "").toLowerCase() === "pesapal";
                  const canRetryBokun =
                    row.bookingId &&
                    row.localPaymentStatus === "paid" &&
                    row.invoiceStatus === "paid" &&
                    Number(row.paidAmount || 0) > 0;
                  return (
                    <tr key={row.bookingReference} className={row.needsAttention ? "admin-payment-row-alert" : ""}>
                      <td>
                        <strong>{row.bookingReference}</strong>
                        <small>{row.productTitle || "-"}</small>
                      </td>
                      <td>
                        <Badge bg={statusVariant(row.pesapalStatus || row.localPaymentStatus)}>
                          {row.pesapalStatus || "-"}
                        </Badge>
                        <small>{row.orderTrackingId || "-"}</small>
                      </td>
                      <td><Badge bg={statusVariant(row.localPaymentStatus)}>{row.localPaymentStatus}</Badge></td>
                      <td><Badge bg={statusVariant(row.invoiceStatus)}>{row.invoiceStatus}</Badge></td>
                      <td>
                        <Badge bg={statusVariant(row.bokunSupplierStatus)}>
                          {row.bokunBookingId || row.bokunSupplierStatus}
                        </Badge>
                      </td>
                      <td>{formatCurrency(row.expectedAmount || 0, row.currency || "USD")}</td>
                      <td>
                        {row.provider === "pesapal" && Number(row.gatewayVerifiedAmount || 0) > 0
                          ? formatCurrency(row.gatewayVerifiedAmount, row.gatewayVerifiedCurrency || row.currency || "USD")
                          : "-"}
                      </td>
                      <td>{formatCurrency(row.paidAmount || 0, row.currency || "USD")}</td>
                      <td>{row.lastVerifiedAt ? formatDate(row.lastVerifiedAt, "MMM D, YYYY HH:mm") : "-"}</td>
                      <td>
                        <div className="admin-payment-actions">
                          <Button
                            size="sm"
                            variant="outline-primary"
                            disabled={!canRecheckPesapal || isBusy}
                            onClick={() =>
                              runAction({
                                key: `${busyPrefix}recheck`,
                                successMessage: `${row.bookingReference} Pesapal status rechecked.`,
                                action: () => recheckPesapalStatus(row.bookingReference)
                              })
                            }
                          >
                            <BsCreditCard2Front /> Recheck
                          </Button>
                          <Button
                            size="sm"
                            variant="outline-success"
                            disabled={isBusy}
                            onClick={() =>
                              runAction({
                                key: `${busyPrefix}invoice`,
                                successMessage: `${row.bookingReference} invoice synced.`,
                                action: () => syncPaymentInvoice(row.bookingReference)
                              })
                            }
                          >
                            <BsReceipt /> Sync Invoice
                          </Button>
                          <Button
                            size="sm"
                            variant="outline-dark"
                            disabled={!canRetryBokun || isBusy}
                            onClick={() =>
                              runAction({
                                key: `${busyPrefix}bokun`,
                                successMessage: `${row.bookingReference} Bókun retry executed.`,
                                action: () =>
                                  retryBokunFromPaymentReconciliation(row.bookingReference, row.bookingId, { force: true })
                              })
                            }
                          >
                            <BsCloudCheck /> Retry Bókun
                          </Button>
                          <Button
                            size="sm"
                            variant={row.reviewed ? "success" : "outline-secondary"}
                            disabled={isBusy}
                            onClick={() =>
                              runAction({
                                key: `${busyPrefix}reviewed`,
                                successMessage: `${row.bookingReference} marked reviewed.`,
                                action: () => markPaymentReviewed(row.bookingReference)
                              })
                            }
                          >
                            {row.reviewed ? <BsShieldCheck /> : <BsCheck2Circle />} Reviewed
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} className="text-center text-muted py-4">
                    No payment reconciliation rows found.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  );
};

export default AdminPaymentsPage;
