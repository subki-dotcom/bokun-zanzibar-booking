import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsEye } from "react-icons/bs";
import { Link } from "react-router-dom";
import { fetchAdminBookingRequests } from "../../api/bookingRequestsApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import { formatCurrency, formatDate } from "../../utils/formatters";

const statusVariant = (value = "") => {
  if (["completed", "approved", "synced", "refunded"].includes(value)) return "success";
  if (["rejected", "failed", "cancelled_by_customer", "unavailable"].includes(value)) return "danger";
  return "warning";
};

const label = (value = "") => String(value || "-").replaceAll("_", " ");

const AdminBookingRequestsPage = () => {
  const [filters, setFilters] = useState({ status: "", type: "", search: "" });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async (nextFilters = filters) => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchAdminBookingRequests({ ...nextFilters, limit: 150 });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load booking requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => ({
    total: rows.length,
    pending: rows.filter((row) => ["submitted", "under_review", "awaiting_availability_check"].includes(row.status)).length,
    payment: rows.filter((row) => row.status === "awaiting_additional_payment").length,
    supplier: rows.filter((row) => ["failed", "manual_action_required"].includes(row.bokunSync?.status)).length
  }), [rows]);

  const submitFilters = (event) => {
    event.preventDefault();
    load(filters);
  };

  return (
    <div className="booking-requests-admin-page">
      <div className="admin-recovery-head">
        <div>
          <h2>Booking Requests</h2>
          <p className="section-subtitle">Review customer reschedules, traveler changes, cancellations, refunds and supplier synchronization.</p>
        </div>
        <Button className="premium-btn text-white" onClick={() => load()} disabled={loading}><BsArrowClockwise /> Refresh</Button>
      </div>

      <ErrorAlert error={error} />
      <Row className="g-3 booking-request-stats">
        <Col sm={6} xl={3}><Card className="surface-card"><Card.Body><small>All Requests</small><strong>{stats.total}</strong></Card.Body></Card></Col>
        <Col sm={6} xl={3}><Card className="surface-card"><Card.Body><small>Pending Review</small><strong>{stats.pending}</strong></Card.Body></Card></Col>
        <Col sm={6} xl={3}><Card className="surface-card"><Card.Body><small>Additional Payment</small><strong>{stats.payment}</strong></Card.Body></Card></Col>
        <Col sm={6} xl={3}><Card className="surface-card"><Card.Body><small>Supplier Attention</small><strong>{stats.supplier}</strong></Card.Body></Card></Col>
      </Row>

      <Card className="surface-card mt-4">
        <Card.Body>
          <Form className="booking-request-filterbar" onSubmit={submitFilters}>
            <Form.Control value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Booking reference, customer, email or Bókun reference" />
            <Form.Select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}>
              <option value="">All types</option><option value="reschedule">Reschedule</option><option value="change_travelers">Traveler change</option><option value="cancel_booking">Cancellation</option><option value="combined_change">Combined change</option>
            </Form.Select>
            <Form.Select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="">All statuses</option><option value="submitted">Submitted</option><option value="under_review">Under review</option><option value="awaiting_additional_payment">Additional payment</option><option value="completed">Completed</option><option value="rejected">Rejected</option><option value="failed">Failed</option>
            </Form.Select>
            <Button type="submit" variant="outline-primary">Filter</Button>
          </Form>

          {loading ? <Loader message="Loading booking requests..." /> : null}
          {!loading && !rows.length ? <div className="text-center text-muted py-5">No booking requests match these filters.</div> : null}
          {!loading && rows.length ? (
            <>
              <Table responsive hover className="align-middle booking-requests-table d-none d-md-table">
                <thead><tr><th>Request</th><th>Booking / Customer</th><th>Tour</th><th>Travel Date</th><th>Paid</th><th>Difference</th><th>Refund</th><th>Request</th><th>Supplier</th><th /></tr></thead>
                <tbody>{rows.map((row) => (
                  <tr key={row._id}>
                    <td><strong>{row.requestReference}</strong><small>{label(row.type)}</small></td>
                    <td><strong>{row.booking?.bookingReference || "-"}</strong><small>{row.booking?.customer?.firstName || ""} {row.booking?.customer?.lastName || ""}<br />{row.booking?.customer?.email || ""}</small></td>
                    <td>{row.booking?.productTitle || "-"}</td><td>{formatDate(row.booking?.travelDate)}</td>
                    <td>{formatCurrency(row.booking?.invoiceSnapshot?.amountPaid || 0, row.booking?.currency || "USD")}</td>
                    <td>{row.priceAdjustment?.difference === null || row.priceAdjustment?.difference === undefined ? "-" : formatCurrency(row.priceAdjustment.difference, row.originalSnapshot?.currency || "USD")}</td>
                    <td>{formatCurrency(row.refund?.estimatedAmount || 0, row.originalSnapshot?.currency || "USD")}</td>
                    <td><Badge bg={statusVariant(row.status)}>{label(row.status)}</Badge></td>
                    <td><Badge bg={statusVariant(row.bokunSync?.status)}>{label(row.bokunSync?.status)}</Badge></td>
                    <td><Button as={Link} to={`/admin/booking-requests/${row._id}`} size="sm" variant="outline-primary" aria-label={`View ${row.requestReference}`}><BsEye /> View</Button></td>
                  </tr>
                ))}</tbody>
              </Table>
              <div className="booking-requests-mobile-list d-md-none">{rows.map((row) => (
                <article key={row._id} className="booking-request-mobile-row">
                  <div><strong>{row.requestReference}</strong><span>{row.booking?.bookingReference} · {label(row.type)}</span></div>
                  <div className="d-flex gap-2 flex-wrap"><Badge bg={statusVariant(row.status)}>{label(row.status)}</Badge><Badge bg={statusVariant(row.bokunSync?.status)}>{label(row.bokunSync?.status)}</Badge></div>
                  <p>{row.booking?.productTitle || "-"}</p><small>{row.booking?.customer?.email || "-"}</small>
                  <Button as={Link} to={`/admin/booking-requests/${row._id}`} variant="outline-primary" size="sm"><BsEye /> Review request</Button>
                </article>
              ))}</div>
            </>
          ) : null}
        </Card.Body>
      </Card>
    </div>
  );
};

export default AdminBookingRequestsPage;
