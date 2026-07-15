import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Row } from "react-bootstrap";
import { BsArrowLeft, BsArrowRepeat, BsCheck2Circle, BsEnvelope, BsExclamationTriangle, BsXCircle } from "react-icons/bs";
import { Link, useParams } from "react-router-dom";
import {
  approveBookingRequest,
  fetchAdminBookingRequest,
  recalculateBookingRequest,
  recordVerifiedAdjustmentPayment,
  rejectBookingRequest,
  requestBookingInformation,
  retryBookingRequestBokunSync,
  retryBookingRequestEmail,
  updateBookingRequestRefund
} from "../../api/bookingRequestsApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import { formatCurrency, formatDate } from "../../utils/formatters";

const label = (value = "") => String(value || "-").replaceAll("_", " ");
const statusVariant = (value = "") => (["completed", "approved", "synced", "refunded", "paid"].includes(value) ? "success" : ["rejected", "failed", "cancelled", "unavailable"].includes(value) ? "danger" : "warning");
const travelerLabel = (pax = {}) => `Adults ${pax.adults || 0}, Children ${pax.children || 0}, Infants ${pax.infants || 0}`;

const DetailRow = ({ label: rowLabel, value }) => <div className="booking-request-detail-row"><span>{rowLabel}</span><strong>{value || "-"}</strong></div>;

const AdminBookingRequestDetailsPage = () => {
  const { requestId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [decision, setDecision] = useState({ customerFacingReason: "", internalNote: "", overrideAmount: "", overrideReason: "", refundAmount: "", refundProvider: "other", paymentProvider: "other" });
  const [refundStatus, setRefundStatus] = useState("processing");
  const [refundReference, setRefundReference] = useState("");
  const [paymentReference, setPaymentReference] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try { setData(await fetchAdminBookingRequest(requestId)); } catch (err) { setError(err.message || "Failed to load request details."); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [requestId]);

  const run = async (key, task, message) => {
    setBusy(key); setError(""); setNotice("");
    try { await task(); setNotice(message); await load(); } catch (err) { setError(err.message || "Action failed."); } finally { setBusy(""); }
  };

  if (loading) return <Loader message="Loading booking request..." />;
  if (!data) return <ErrorAlert error={error || "Booking request not found."} />;

  const { request, payments = [], invoice, audit = [] } = data;
  const booking = request.booking || {};
  const currency = request.originalSnapshot?.currency || booking.currency || "USD";
  const refund = request.refund?.refundId;
  const adjustment = request.additionalPayment?.paymentAdjustmentId;
  const approvePayload = {
    customerFacingReason: decision.customerFacingReason,
    internalNote: decision.internalNote,
    ...(decision.overrideAmount !== "" ? { overrideAmount: Number(decision.overrideAmount), overrideReason: decision.overrideReason } : {}),
    ...(decision.refundAmount !== "" ? { refundAmount: Number(decision.refundAmount), refundProvider: decision.refundProvider } : {}),
    paymentProvider: decision.paymentProvider
  };

  return (
    <div className="booking-request-details-page">
      <div className="admin-recovery-head">
        <div><Button as={Link} to="/admin/booking-requests" size="sm" variant="link" className="px-0"><BsArrowLeft /> Booking Requests</Button><h2>{request.requestReference}</h2><p className="section-subtitle">{label(request.type)} · submitted {formatDate(request.createdAt, "MMM D, YYYY HH:mm")}</p></div>
        <div className="d-flex gap-2 flex-wrap"><Badge bg={statusVariant(request.status)}>{label(request.status)}</Badge><Badge bg={statusVariant(request.bokunSync?.status)}>{label(request.bokunSync?.status)}</Badge></div>
      </div>
      <ErrorAlert error={error} />
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      <Row className="g-3 align-items-start">
        <Col xl={8}>
          <Card className="surface-card mb-3"><Card.Body><h5>Request Summary</h5><div className="booking-request-detail-grid"><DetailRow label="Reason" value={request.customerReason} /><DetailRow label="Customer notes" value={request.customerNotes} /><DetailRow label="Original amount" value={formatCurrency(request.originalSnapshot?.totalAmount || 0, currency)} /><DetailRow label="Estimated refund" value={formatCurrency(request.refund?.estimatedAmount || 0, currency)} /></div></Card.Body></Card>
          <Card className="surface-card mb-3"><Card.Body><h5>Booking and Customer</h5><div className="booking-request-detail-grid"><DetailRow label="Booking reference" value={booking.bookingReference} /><DetailRow label="Bókun booking" value={booking.bokunBookingId} /><DetailRow label="Tour" value={booking.productTitle} /><DetailRow label="Option" value={booking.optionTitle} /><DetailRow label="Customer" value={`${booking.customer?.firstName || ""} ${booking.customer?.lastName || ""}`.trim()} /><DetailRow label="Email" value={booking.customer?.email} /><DetailRow label="Phone" value={booking.customer?.phone} /><DetailRow label="Travel date" value={`${formatDate(booking.travelDate)} ${booking.startTime || ""}`} /></div></Card.Body></Card>
          <Card className="surface-card mb-3"><Card.Body><h5>Original vs Requested</h5><div className="booking-request-comparison"><div><h6>Original</h6><DetailRow label="Date / time" value={`${formatDate(request.originalSnapshot?.date)} ${request.originalSnapshot?.startTime || ""}`} /><DetailRow label="Travelers" value={travelerLabel(request.originalSnapshot?.travelers)} /><DetailRow label="Pickup" value={request.originalSnapshot?.pickup?.hotelName} /></div><div><h6>Requested</h6><DetailRow label="Date / time" value={`${formatDate(request.requestedChanges?.date || request.originalSnapshot?.date)} ${request.requestedChanges?.startTime || request.originalSnapshot?.startTime || ""}`} /><DetailRow label="Travelers" value={request.requestedChanges?.travelers ? travelerLabel(request.requestedChanges.travelers) : "No traveler change"} /><DetailRow label="Price difference" value={request.priceAdjustment?.difference === null || request.priceAdjustment?.difference === undefined ? "Not calculated" : formatCurrency(request.priceAdjustment.difference, currency)} /></div></div></Card.Body></Card>
          <Card className="surface-card mb-3"><Card.Body><h5>Payment and Invoice</h5><div className="booking-request-detail-grid"><DetailRow label="Invoice status" value={invoice?.paymentStatus} /><DetailRow label="Invoice amount paid" value={formatCurrency(invoice?.amountPaid || 0, currency)} /><DetailRow label="Amount refunded" value={formatCurrency(invoice?.amountRefunded || 0, currency)} /><DetailRow label="Balance due" value={formatCurrency(invoice?.balanceDue || 0, currency)} /></div>{payments.length ? <div className="booking-request-payments">{payments.map((payment) => <div key={payment._id}><strong>{payment.provider}</strong><span>{payment.status} · {formatCurrency(payment.amountPaid || payment.paidAmount || 0, payment.currency || currency)}</span></div>)}</div> : <small className="text-muted">No local payment record found.</small>}</Card.Body></Card>
          <Card className="surface-card"><Card.Body><h5>Audit History</h5><div className="booking-request-audit">{audit.length ? audit.map((event) => <div key={event._id}><strong>{label(event.action)}</strong><span>{formatDate(event.createdAt, "MMM D, YYYY HH:mm")} · {event.actorRole}</span></div>) : <span className="text-muted">No audit events recorded yet.</span>}</div></Card.Body></Card>
        </Col>
        <Col xl={4}>
          <Card className="surface-card mb-3"><Card.Body><h5>Supplier Synchronization</h5><DetailRow label="Status" value={label(request.bokunSync?.status)} /><DetailRow label="Attempts" value={request.bokunSync?.attempts} /><DetailRow label="Last error" value={request.bokunSync?.lastError || "-"} /><div className="booking-request-admin-actions"><Button variant="outline-primary" disabled={Boolean(busy)} onClick={() => run("recalculate", () => recalculateBookingRequest(request._id), "Availability and price recalculated.")}><BsArrowRepeat /> Recalculate</Button><Button variant="outline-dark" disabled={Boolean(busy)} onClick={() => run("bokun", () => retryBookingRequestBokunSync(request._id), "Supplier sync retried.")}>Retry Bókun Sync</Button><Button variant="outline-secondary" disabled={Boolean(busy)} onClick={() => run("email", () => retryBookingRequestEmail(request._id), "Email delivery retried.")}><BsEnvelope /> Retry Email</Button></div></Card.Body></Card>
          <Card className="surface-card mb-3"><Card.Body><h5>Decision</h5><Form.Group className="mb-2"><Form.Label>Customer-facing reason</Form.Label><Form.Control as="textarea" rows={2} value={decision.customerFacingReason} onChange={(event) => setDecision((current) => ({ ...current, customerFacingReason: event.target.value }))} /></Form.Group><Form.Group className="mb-2"><Form.Label>Internal note</Form.Label><Form.Control as="textarea" rows={2} value={decision.internalNote} onChange={(event) => setDecision((current) => ({ ...current, internalNote: event.target.value }))} /></Form.Group><Form.Group className="mb-2"><Form.Label>Override price difference (optional)</Form.Label><Form.Control type="number" value={decision.overrideAmount} onChange={(event) => setDecision((current) => ({ ...current, overrideAmount: event.target.value }))} /></Form.Group>{decision.overrideAmount !== "" ? <Form.Group className="mb-3"><Form.Label>Override reason</Form.Label><Form.Control value={decision.overrideReason} onChange={(event) => setDecision((current) => ({ ...current, overrideReason: event.target.value }))} /></Form.Group> : null}<div className="booking-request-admin-actions"><Button variant="success" disabled={Boolean(busy)} onClick={() => run("approve", () => approveBookingRequest(request._id, approvePayload), "Approval processed.")}><BsCheck2Circle /> Approve</Button><Button variant="outline-warning" disabled={Boolean(busy) || !decision.customerFacingReason.trim()} onClick={() => run("information", () => requestBookingInformation(request._id, { customerFacingReason: decision.customerFacingReason, internalNote: decision.internalNote }), "Customer information requested.")}>Request Info</Button><Button variant="outline-danger" disabled={Boolean(busy) || !decision.customerFacingReason.trim()} onClick={() => run("reject", () => rejectBookingRequest(request._id, { customerFacingReason: decision.customerFacingReason, internalNote: decision.internalNote }), "Request rejected.")}><BsXCircle /> Reject</Button></div></Card.Body></Card>
          {refund ? <Card className="surface-card mb-3"><Card.Body><h5>Refund Management</h5><DetailRow label="Reference" value={refund.refundReference} /><DetailRow label="Amount" value={formatCurrency(refund.amount, refund.currency || currency)} /><DetailRow label="Provider" value={refund.provider} /><Form.Select className="mt-3" value={refundStatus} onChange={(event) => setRefundStatus(event.target.value)}><option value="processing">Processing</option><option value="partially_refunded">Partially refunded</option><option value="refunded">Refunded</option><option value="failed">Failed</option><option value="manual_review">Manual review</option></Form.Select><Form.Control className="mt-2" value={refundReference} onChange={(event) => setRefundReference(event.target.value)} placeholder="Provider refund reference" /><Button className="mt-2" variant="outline-success" disabled={Boolean(busy)} onClick={() => run("refund", () => updateBookingRequestRefund(refund._id, { status: refundStatus, providerRefundReference: refundReference }), "Refund status updated.")}>Update Refund</Button></Card.Body></Card> : null}
          {adjustment ? <Card className="surface-card"><Card.Body><h5>Additional Payment</h5><DetailRow label="Reference" value={adjustment.adjustmentReference} /><DetailRow label="Amount" value={formatCurrency(adjustment.amount, adjustment.currency || currency)} /><DetailRow label="Status" value={adjustment.status} /><Form.Control className="mt-3" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Verified provider reference" /><Button className="mt-2" variant="outline-success" disabled={Boolean(busy) || !paymentReference.trim()} onClick={() => run("adjustment", () => recordVerifiedAdjustmentPayment(adjustment._id, { paymentReference }), "Verified adjustment payment recorded.")}><BsExclamationTriangle /> Record verified payment</Button><small className="d-block text-muted mt-2">Use only after server-side provider verification or verified manual settlement.</small></Card.Body></Card> : null}
        </Col>
      </Row>
    </div>
  );
};

export default AdminBookingRequestDetailsPage;
