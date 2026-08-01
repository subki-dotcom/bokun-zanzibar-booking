import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Row } from "react-bootstrap";
import { BsArrowLeft, BsArrowRepeat, BsCheck2Circle, BsEnvelope, BsExclamationTriangle, BsXCircle } from "react-icons/bs";
import { Link, useParams } from "react-router-dom";
import {
  approveBookingRequest,
  fetchAdminBookingRequest,
  processBookingRequestRefund,
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
import { cancellationDisplayText, formatCancellationDeadline, hasKnownRefundAmount } from "../../utils/cancellationPolicy";

const label = (value = "") => String(value || "-").replaceAll("_", " ");
const statusVariant = (value = "") => (["completed", "approved", "synced", "refunded", "paid", "eligible"].includes(value) ? "success" : ["rejected", "failed", "cancelled", "unavailable"].includes(value) ? "danger" : "warning");
const travelerLabel = (pax = {}) => `Adults ${pax.adults || 0}, Children ${pax.children || 0}, Infants ${pax.infants || 0}`;
const providerLabel = (value = "") => ({ paypal: "PayPal", pesapal: "Pesapal", dpo: "DPO Pay", manual_bank_transfer: "Manual bank transfer", cash: "Cash", other: "Other" }[String(value || "").toLowerCase()] || value || "-");
const maskReference = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "-";
  if (text.length <= 8) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
};

const DetailRow = ({ label: rowLabel, value }) => <div className="booking-request-detail-row"><span>{rowLabel}</span><strong>{value || "-"}</strong></div>;

const formatMaybeMoney = (value, currency, fallback = "Manual review") =>
  hasKnownRefundAmount(value) ? formatCurrency(value, currency) : fallback;

const AdminCancellationPolicyCard = ({ policy = null, currency = "USD" }) => {
  if (!policy) return null;
  const deadline = formatCancellationDeadline(policy) || "Not confirmed";
  const policyMessage = cancellationDisplayText(policy.reviewReason) ||
    cancellationDisplayText(policy.policySummary) ||
    "Policy snapshot captured from supplier data.";
  return (
    <Card className="surface-card mb-3">
      <Card.Body>
        <h5>Cancellation Policy Snapshot</h5>
        <div className="booking-request-detail-grid">
          <DetailRow label="Policy available" value={policy.policyAvailable ? "Yes" : "No"} />
          <DetailRow label="Free deadline" value={deadline} />
          <DetailRow label="Policy status" value={policy.isFreeCancellationAvailable ? "Free cancellation available" : policy.freeCancellationExpired ? "Free period ended" : "Review required"} />
          <DetailRow label="Manual review" value={policy.requiresManualReview ? "Required" : "Not required"} />
          <DetailRow label="Cancellation fee" value={formatMaybeMoney(policy.estimatedCancellationFee, currency)} />
          <DetailRow label="Eligible refund" value={formatMaybeMoney(policy.estimatedRefundAmount, currency)} />
        </div>
        <p className="text-muted mb-0 mt-2">{policyMessage}</p>
      </Card.Body>
    </Card>
  );
};

const CancellationRefundCard = ({ request, booking, invoice, payments, refundContext, currency }) => {
  if (request.type !== "cancel_booking") return null;
  const refund = request.refund?.refundId;
  const policy = request.cancellationPolicySnapshot || {};
  const amountPaid = refundContext?.amountPaid ?? invoice?.amountPaid ?? request.originalSnapshot?.amountPaid ?? 0;
  const previousRefunded = refundContext?.previouslyRefundedAmount ?? invoice?.amountRefunded ?? 0;
  const remaining = refundContext?.remainingRefundableAmount ?? Math.max(0, Number(amountPaid || 0) - Number(previousRefunded || 0));
  const netPaid = invoice?.netAmountPaid ?? Math.max(0, Number(amountPaid || 0) - Number(previousRefunded || 0));
  const eligible = refundContext?.eligibleRefundAmount ?? request.refund?.eligibleAmount ?? policy.estimatedRefundAmount;
  const approved = request.refund?.approvedAmount ?? refund?.amount ?? refundContext?.defaultApprovedRefundAmount;
  const provider = refundContext?.providerKnown ? refundContext.providerLabel : request.refund?.providerLabel || providerLabel(request.refund?.provider);

  return (
    <Card className="surface-card mb-3 cancellation-refund-card">
      <Card.Body>
        <h5>Cancellation and Refund</h5>
        <div className="booking-request-detail-grid">
          <DetailRow label="Cancellation deadline" value={formatCancellationDeadline(policy) || "Not confirmed"} />
          <DetailRow label="Request submitted" value={formatDate(request.createdAt, "MMM D, YYYY HH:mm")} />
          <DetailRow label="Cancellation status" value={label(request.status)} />
          <DetailRow label="Bokun confirmation" value={request.bokunSync?.status === "synced" || booking.bookingStatus === "cancelled" ? "Confirmed cancelled" : label(request.bokunSync?.status)} />
          <DetailRow label="Amount actually paid" value={formatCurrency(amountPaid, currency)} />
          <DetailRow label="Invoice payment status" value={label(invoice?.paymentStatus || booking.paymentStatus)} />
          <DetailRow label="Successful payment provider" value={refundContext?.providerKnown ? provider : "Manual review required"} />
          <DetailRow label="Successful transaction" value={refundContext?.originalTransactionReferenceMasked || "-"} />
          <DetailRow label="Previously refunded" value={formatCurrency(previousRefunded, currency)} />
          <DetailRow label="Net paid after confirmed refunds" value={formatCurrency(netPaid, currency)} />
          <DetailRow label="Remaining refundable" value={formatCurrency(remaining, currency)} />
          <DetailRow label="Eligible refund" value={formatMaybeMoney(eligible, currency)} />
          <DetailRow label="Cancellation fee" value={formatMaybeMoney(request.refund?.cancellationFee ?? policy.estimatedCancellationFee, currency)} />
          <DetailRow label="Approved refund amount" value={formatMaybeMoney(approved, currency, "Not approved yet")} />
          <DetailRow label="Refund destination" value={refundContext?.providerKnown ? `${provider} - original payment method` : "Manual review required"} />
          <DetailRow label="Refund status" value={label(refund?.status || request.refund?.status || "not_required")} />
          <DetailRow label="Provider refund reference" value={maskReference(refund?.providerRefundReference)} />
          <DetailRow label="Confirmed amount refunded" value={formatCurrency(refund?.confirmedRefundedAmount || request.refund?.confirmedRefundedAmount || 0, currency)} />
        </div>
        {refundContext?.manualReviewReason ? <Alert variant="warning" className="mt-3 mb-0">{refundContext.manualReviewReason}</Alert> : null}
        {payments.length ? (
          <div className="booking-request-payments mt-3">
            {payments.map((payment) => (
              <div key={payment._id}>
                <strong>{providerLabel(payment.provider)}</strong>
                <span>{label(payment.status)} - {formatCurrency(payment.amountPaid || payment.paidAmount || 0, payment.currency || currency)}</span>
              </div>
            ))}
          </div>
        ) : <small className="text-muted">No local payment record found.</small>}
      </Card.Body>
    </Card>
  );
};

const AdminBookingRequestDetailsPage = () => {
  const { requestId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [decision, setDecision] = useState({ customerFacingReason: "", internalNote: "", overrideAmount: "", overrideReason: "", refundAmount: "", paymentProvider: "other" });
  const [refundStatus, setRefundStatus] = useState("processing");
  const [refundReference, setRefundReference] = useState("");
  const [confirmedAmount, setConfirmedAmount] = useState("");
  const [refundNotes, setRefundNotes] = useState("");
  const [paymentReference, setPaymentReference] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try { setData(await fetchAdminBookingRequest(requestId)); } catch (err) { setError(err.message || "Failed to load request details."); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [requestId]);

  useEffect(() => {
    if (!data?.request || data.request.type !== "cancel_booking") return;
    const nextAmount =
      data.request.refund?.approvedAmount ??
      data.refundContext?.defaultApprovedRefundAmount ??
      data.request.refund?.eligibleAmount ??
      data.request.cancellationPolicySnapshot?.estimatedRefundAmount;
    setDecision((current) => ({
      ...current,
      refundAmount: current.refundAmount || (hasKnownRefundAmount(nextAmount) ? String(nextAmount) : "")
    }));
  }, [data?.request?._id, data?.refundContext?.defaultApprovedRefundAmount]);

  const run = async (key, task, message) => {
    setBusy(key); setError(""); setNotice("");
    try { await task(); setNotice(message); await load(); } catch (err) { setError(err.message || "Action failed."); } finally { setBusy(""); }
  };

  if (loading) return <Loader message="Loading booking request..." />;
  if (!data) return <ErrorAlert error={error || "Booking request not found."} />;

  const { request, payments = [], invoice, audit = [], refundContext } = data;
  const booking = request.booking || {};
  const currency = request.originalSnapshot?.currency || booking.currency || "USD";
  const refund = request.refund?.refundId;
  const adjustment = request.additionalPayment?.paymentAdjustmentId;
  const isCancellation = request.type === "cancel_booking";
  const resolvedRefundProviderLabel = refundContext?.providerKnown ? refundContext.providerLabel : providerLabel(refund?.provider);
  const approvePayload = {
    customerFacingReason: decision.customerFacingReason,
    internalNote: decision.internalNote,
    ...(decision.overrideAmount !== "" ? { overrideAmount: Number(decision.overrideAmount), overrideReason: decision.overrideReason } : {}),
    ...(isCancellation && decision.refundAmount !== "" ? { refundAmount: Number(decision.refundAmount) } : {}),
    paymentProvider: decision.paymentProvider
  };
  const refundAmount = Number(refund?.amount || request.refund?.approvedAmount || 0);
  const refundIsComplete = ["refunded", "partially_refunded"].includes(String(refund?.status || ""));
  const refundCanProcess =
    Boolean(refund?._id) &&
    request.bokunSync?.status === "synced" &&
    booking.bookingStatus === "cancelled" &&
    refundAmount > 0 &&
    !refundIsComplete &&
    String(refund.status || "") === "approved" &&
    Boolean(refundContext?.providerKnown) &&
    Number(refund?.confirmedRefundedAmount || 0) <= 0;
  const refundDisabledReason =
    !refund?._id ? "Approve cancellation first."
      : request.bokunSync?.status !== "synced" || booking.bookingStatus !== "cancelled" ? "Waiting for Bokun cancellation confirmation."
        : refundIsComplete ? "Refund already confirmed."
          : String(refund.status || "") === "processing" ? "Refund is already processing."
            : String(refund.status || "") !== "approved" ? "Refund is not in an approved processable state."
            : !refundContext?.providerKnown ? "Original provider requires manual review."
              : refundAmount <= 0 ? "Refund amount is zero."
                : "";

  return (
    <div className="booking-request-details-page">
      <div className="admin-recovery-head">
        <div><Button as={Link} to="/admin/booking-requests" size="sm" variant="link" className="px-0"><BsArrowLeft /> Booking Requests</Button><h2>{request.requestReference}</h2><p className="section-subtitle">{label(request.type)} - submitted {formatDate(request.createdAt, "MMM D, YYYY HH:mm")}</p></div>
        <div className="d-flex gap-2 flex-wrap"><Badge bg={statusVariant(request.status)}>{label(request.status)}</Badge><Badge bg={statusVariant(request.bokunSync?.status)}>{label(request.bokunSync?.status)}</Badge></div>
      </div>
      <ErrorAlert error={error} />
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      <Row className="g-3 align-items-start">
        <Col xl={8}>
          <Card className="surface-card mb-3"><Card.Body><h5>Request Summary</h5><div className="booking-request-detail-grid"><DetailRow label="Reason" value={request.customerReason} /><DetailRow label="Customer notes" value={request.customerNotes} /><DetailRow label="Original amount" value={formatCurrency(request.originalSnapshot?.totalAmount || 0, currency)} /><DetailRow label="Eligible refund" value={formatMaybeMoney(request.refund?.eligibleAmount ?? request.refund?.estimatedAmount, currency)} /></div></Card.Body></Card>
          {isCancellation ? <AdminCancellationPolicyCard policy={request.cancellationPolicySnapshot} currency={currency} /> : null}
          {isCancellation ? <CancellationRefundCard request={request} booking={booking} invoice={invoice} payments={payments} refundContext={refundContext} currency={currency} /> : null}
          <Card className="surface-card mb-3"><Card.Body><h5>Booking and Customer</h5><div className="booking-request-detail-grid"><DetailRow label="Booking reference" value={booking.bookingReference} /><DetailRow label="Bokun booking" value={booking.bokunBookingId} /><DetailRow label="Tour" value={booking.productTitle} /><DetailRow label="Option" value={booking.optionTitle} /><DetailRow label="Customer" value={`${booking.customer?.firstName || ""} ${booking.customer?.lastName || ""}`.trim()} /><DetailRow label="Email" value={booking.customer?.email} /><DetailRow label="Phone" value={booking.customer?.phone} /><DetailRow label="Travel date" value={`${formatDate(booking.travelDate)} ${booking.startTime || ""}`} /></div></Card.Body></Card>
          <Card className="surface-card mb-3"><Card.Body><h5>Original vs Requested</h5><div className="booking-request-comparison"><div><h6>Original</h6><DetailRow label="Date / time" value={`${formatDate(request.originalSnapshot?.date)} ${request.originalSnapshot?.startTime || ""}`} /><DetailRow label="Travelers" value={travelerLabel(request.originalSnapshot?.travelers)} /><DetailRow label="Pickup" value={request.originalSnapshot?.pickup?.hotelName} /></div><div><h6>Requested</h6><DetailRow label="Date / time" value={`${formatDate(request.requestedChanges?.date || request.originalSnapshot?.date)} ${request.requestedChanges?.startTime || request.originalSnapshot?.startTime || ""}`} /><DetailRow label="Travelers" value={request.requestedChanges?.travelers ? travelerLabel(request.requestedChanges.travelers) : "No traveler change"} /><DetailRow label="Price difference" value={request.priceAdjustment?.difference === null || request.priceAdjustment?.difference === undefined ? "Not calculated" : formatCurrency(request.priceAdjustment.difference, currency)} /></div></div></Card.Body></Card>
          {!isCancellation ? <Card className="surface-card mb-3"><Card.Body><h5>Payment and Invoice</h5><div className="booking-request-detail-grid"><DetailRow label="Invoice status" value={invoice?.paymentStatus} /><DetailRow label="Invoice amount paid" value={formatCurrency(invoice?.amountPaid || 0, currency)} /><DetailRow label="Amount refunded" value={formatCurrency(invoice?.amountRefunded || 0, currency)} /><DetailRow label="Balance due" value={formatCurrency(invoice?.balanceDue || 0, currency)} /></div></Card.Body></Card> : null}
          <Card className="surface-card"><Card.Body><h5>Audit History</h5><div className="booking-request-audit">{audit.length ? audit.map((event) => <div key={event._id}><strong>{label(event.action)}</strong><span>{formatDate(event.createdAt, "MMM D, YYYY HH:mm")} - {event.actorRole}</span></div>) : <span className="text-muted">No audit events recorded yet.</span>}</div></Card.Body></Card>
        </Col>
        <Col xl={4}>
          <Card className="surface-card mb-3"><Card.Body><h5>Supplier Synchronization</h5><DetailRow label="Status" value={label(request.bokunSync?.status)} /><DetailRow label="Attempts" value={request.bokunSync?.attempts} /><DetailRow label="Last error" value={request.bokunSync?.lastError || "-"} /><div className="booking-request-admin-actions"><Button variant="outline-primary" disabled={Boolean(busy)} onClick={() => run("recalculate", () => recalculateBookingRequest(request._id), "Availability and price recalculated.")}><BsArrowRepeat /> Recalculate</Button><Button variant="outline-dark" disabled={Boolean(busy)} onClick={() => run("bokun", () => retryBookingRequestBokunSync(request._id), "Supplier sync retried.")}>Retry Bokun Sync</Button><Button variant="outline-secondary" disabled={Boolean(busy)} onClick={() => run("email", () => retryBookingRequestEmail(request._id), "Email delivery retried.")}><BsEnvelope /> Retry Email</Button></div></Card.Body></Card>
          <Card className="surface-card mb-3"><Card.Body><h5>{isCancellation ? "Cancellation Decision" : "Decision"}</h5><Form.Group className="mb-2"><Form.Label>Customer-facing reason</Form.Label><Form.Control as="textarea" rows={2} value={decision.customerFacingReason} onChange={(event) => setDecision((current) => ({ ...current, customerFacingReason: event.target.value }))} /></Form.Group><Form.Group className="mb-2"><Form.Label>Internal note</Form.Label><Form.Control as="textarea" rows={2} value={decision.internalNote} onChange={(event) => setDecision((current) => ({ ...current, internalNote: event.target.value }))} /></Form.Group>{!isCancellation ? <><Form.Group className="mb-2"><Form.Label>Override price difference (optional)</Form.Label><Form.Control type="number" value={decision.overrideAmount} onChange={(event) => setDecision((current) => ({ ...current, overrideAmount: event.target.value }))} /></Form.Group>{decision.overrideAmount !== "" ? <Form.Group className="mb-3"><Form.Label>Override reason</Form.Label><Form.Control value={decision.overrideReason} onChange={(event) => setDecision((current) => ({ ...current, overrideReason: event.target.value }))} /></Form.Group> : null}</> : null}{isCancellation ? <div className="booking-request-refund-editor"><Form.Group className="mb-2"><Form.Label>Approved refund amount</Form.Label><Form.Control type="number" min="0" step="0.01" value={decision.refundAmount} onChange={(event) => setDecision((current) => ({ ...current, refundAmount: event.target.value }))} placeholder={String(refundContext?.defaultApprovedRefundAmount ?? request.refund?.eligibleAmount ?? "")} /></Form.Group><Form.Group className="mb-3"><Form.Label>Refund destination</Form.Label><Form.Control value={refundContext?.providerKnown ? `${refundContext.providerLabel} - original payment method` : "Manual review required"} readOnly /></Form.Group>{refundContext?.manualReviewReason ? <Alert variant="warning">{refundContext.manualReviewReason}</Alert> : null}</div> : null}<div className="booking-request-admin-actions"><Button variant="success" disabled={Boolean(busy)} onClick={() => { if (isCancellation && !window.confirm("Approve this cancellation and submit it to Bokun? Refund processing will remain separate.")) return; run("approve", () => approveBookingRequest(request._id, approvePayload), isCancellation ? "Cancellation approval processed." : "Approval processed."); }}><BsCheck2Circle /> {isCancellation ? "Approve Cancellation" : "Approve"}</Button><Button variant="outline-warning" disabled={Boolean(busy) || !decision.customerFacingReason.trim()} onClick={() => run("information", () => requestBookingInformation(request._id, { customerFacingReason: decision.customerFacingReason, internalNote: decision.internalNote }), "Customer information requested.")}>Request Info</Button><Button variant="outline-danger" disabled={Boolean(busy) || !decision.customerFacingReason.trim()} onClick={() => run("reject", () => rejectBookingRequest(request._id, { customerFacingReason: decision.customerFacingReason, internalNote: decision.internalNote }), "Request rejected.")}><BsXCircle /> Reject</Button></div></Card.Body></Card>
          {refund ? <Card className="surface-card mb-3"><Card.Body><h5>Refund Management</h5><DetailRow label="Reference" value={refund.refundReference} /><DetailRow label="Approved amount" value={formatCurrency(refund.amount, refund.currency || currency)} /><DetailRow label="Provider" value={resolvedRefundProviderLabel} /><DetailRow label="Status" value={label(refund.status)} /><DetailRow label="Confirmed refunded" value={formatCurrency(refund.confirmedRefundedAmount || 0, refund.currency || currency)} /><Button className="w-100 mt-3" variant="success" disabled={Boolean(busy) || !refundCanProcess} onClick={() => { if (!window.confirm(`Process refund of ${formatCurrency(refund.amount, refund.currency || currency)} via ${resolvedRefundProviderLabel}?`)) return; run("process-refund", () => processBookingRequestRefund(refund._id, { notes: refundNotes }), "Refund processing updated."); }}>Process Refund - {formatCurrency(refund.amount, refund.currency || currency)} via {resolvedRefundProviderLabel}</Button>{refundDisabledReason ? <small className="text-muted d-block mt-2">{refundDisabledReason}</small> : null}<Form.Control className="mt-3" value={refundNotes} onChange={(event) => setRefundNotes(event.target.value)} placeholder="Optional refund processing note" /><hr /><Form.Select className="mt-3" value={refundStatus} onChange={(event) => setRefundStatus(event.target.value)}><option value="processing">Processing</option><option value="verification_required">Verification required</option><option value="partially_refunded">Partially refunded</option><option value="refunded">Refunded</option><option value="failed">Failed</option><option value="manual_refund_required">Manual refund required</option><option value="manual_review">Manual review</option></Form.Select><Form.Control className="mt-2" value={refundReference} onChange={(event) => setRefundReference(event.target.value)} placeholder="Provider refund reference" /><Form.Control className="mt-2" type="number" min="0" step="0.01" value={confirmedAmount} onChange={(event) => setConfirmedAmount(event.target.value)} placeholder="Confirmed amount, only for completed refund" /><Button className="mt-2" variant="outline-success" disabled={Boolean(busy)} onClick={() => run("refund", () => updateBookingRequestRefund(refund._id, { status: refundStatus, providerRefundReference: refundReference, ...(confirmedAmount !== "" ? { confirmedAmount: Number(confirmedAmount) } : {}) }), "Refund status updated.")}>Record Manual Refund Update</Button><small className="d-block text-muted mt-2">Use manual update only after provider or merchant portal confirmation.</small></Card.Body></Card> : null}
          {adjustment ? <Card className="surface-card"><Card.Body><h5>Additional Payment</h5><DetailRow label="Reference" value={adjustment.adjustmentReference} /><DetailRow label="Amount" value={formatCurrency(adjustment.amount, adjustment.currency || currency)} /><DetailRow label="Status" value={adjustment.status} /><Form.Control className="mt-3" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Verified provider reference" /><Button className="mt-2" variant="outline-success" disabled={Boolean(busy) || !paymentReference.trim()} onClick={() => run("adjustment", () => recordVerifiedAdjustmentPayment(adjustment._id, { paymentReference }), "Verified adjustment payment recorded.")}><BsExclamationTriangle /> Record verified payment</Button><small className="d-block text-muted mt-2">Use only after server-side provider verification or verified manual settlement.</small></Card.Body></Card> : null}
        </Col>
      </Row>
    </div>
  );
};

export default AdminBookingRequestDetailsPage;
