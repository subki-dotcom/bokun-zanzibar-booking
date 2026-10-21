import { useCallback, useEffect, useState } from "react";
import { Button, Card, Col, ListGroup, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsArrowLeft, BsBoxArrowUpRight } from "react-icons/bs";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../../../components/admin/PageHeader";
import Loader from "../../../../../shared/src/components/common/Loader";
import useAuth from "../../../../../shared/src/hooks/useAuth";
import { formatDateTime } from "../../../components/admin/AdminDataWidgets";
import { fetchFinanceEscalation } from "../../../api/financeEscalationsApi";
import { BACK_OFFICE_ROLES } from "../../../routes/backOfficeAccess";
import {
  categoryLabel,
  requestStateLabel,
  requestStateTone,
  requestTypeLabel,
  statusWords,
  travellerSummary
} from "../../../config/tourOperations";
import { PaymentBadge, SupplierBadge, ToneBadge, tourAdminErrorMessage } from "../../../components/admin/tourAdmin/TourAdminUi";

const Field = ({ label, children }) => (
  <div className="mb-3">
    <small className="text-muted d-block">{label}</small>
    <div>{children ?? "-"}</div>
  </div>
);

// Amounts are shown only when recorded; a missing amount is never shown as zero.
const money = (value, currency) => {
  if (value === null || value === undefined) return <span className="text-muted">Not recorded</span>;
  try {
    return currency ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value) : String(value);
  } catch {
    return `${currency} ${value}`;
  }
};

const historyText = (entry) => {
  if (entry.action === "note_added") return "Internal note added";
  if (entry.action === "category_changed") return `Category set to ${categoryLabel(entry.category)}`;
  if (entry.action === "escalated") return `Escalated to ${entry.escalatedTo === "FINANCE" ? "Finance" : "supplier action"} (${requestStateLabel(entry.fromState)} → ${requestStateLabel(entry.toState)})`;
  if (entry.action === "state_changed") return `${requestStateLabel(entry.fromState)} → ${requestStateLabel(entry.toState)}`;
  return statusWords(entry.action);
};

// Finance review of one escalated request. There are no actions here: refunds, payment adjustments and
// customer decisions are made in the existing Back Office request screen, linked below.
const FinanceEscalationDetailsPage = () => {
  const { requestId } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetchFinanceEscalation(requestId));
    } catch (err) {
      setData(null);
      setError(tourAdminErrorMessage(err, "This escalation could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => { load(); }, [load]);

  const back = <Button as={Link} to="/admin/finance/escalations" variant="outline-secondary"><BsArrowLeft aria-hidden="true" /> All escalations</Button>;
  if (loading) return <Loader message="Loading escalation..." />;
  if (!data) {
    return (
      <div className="finance-escalation-details">
        <PageHeader eyebrow="Finance Escalations" title="Escalated request" actions={back} />
        <div className="alert alert-danger mt-3" role="alert">{error}</div>
      </div>
    );
  }

  const evidence = data.financeEvidence || {};
  const currency = evidence.currency || "";
  const booking = data.booking;
  // The existing request screen is the place for Finance actions; it is open to these roles.
  const canOpenRequestScreen = BACK_OFFICE_ROLES.includes(user?.role);

  return (
    <div className="finance-escalation-details">
      <PageHeader
        eyebrow="Finance Escalations"
        title={data.requestReference || data.id}
        description={`${requestTypeLabel(data.type)} · ${booking?.bookingReference || ""}`}
        actions={(
          <div className="d-flex flex-wrap gap-2">
            {back}
            <Button variant="outline-secondary" onClick={load}><BsArrowClockwise aria-hidden="true" /> Refresh</Button>
            {canOpenRequestScreen ? (
              <Button as={Link} to={`/admin/finance/booking-requests/${data.id}`} variant="outline-primary">
                <BsBoxArrowUpRight aria-hidden="true" /> Refunds and payments
              </Button>
            ) : null}
          </div>
        )}
      />
      {data.notice ? <div className="alert alert-info small mt-3" role="note">{data.notice}</div> : null}

      <Row className="g-3 mt-1">
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h3 className="h6">Escalation</h3>
              <Field label="Operations state"><ToneBadge tone={requestStateTone(data.state)}>{requestStateLabel(data.state)}</ToneBadge></Field>
              <Field label="Category">{categoryLabel(data.category)}</Field>
              <Field label="Reason">{data.escalation ? (data.escalation.reason || <span className="text-muted">No reason recorded</span>) : <span className="text-muted">Not recorded</span>}</Field>
              <Field label="Escalated">{data.escalation?.at ? formatDateTime(data.escalation.at) : <span className="text-muted">Not recorded</span>}</Field>
              {data.escalation?.actorRole ? <Field label="Escalated by">{statusWords(data.escalation.actorRole)} {data.escalation.actorId}</Field> : null}
              <Field label="Submitted by customer">{formatDateTime(data.submittedAt)}</Field>
              <Field label="Customer decision (Back Office)">{statusWords(data.customerStatus)}</Field>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h3 className="h6">Customer request</h3>
              <Field label="Current booking">{[data.request?.original?.date, data.request?.original?.startTime].filter(Boolean).join(" at ") || "-"}{data.request?.original?.optionTitle ? ` · ${data.request.original.optionTitle}` : ""}</Field>
              <Field label="Current travellers">{travellerSummary(data.request?.original?.travelers)}</Field>
              {data.request?.requestedChanges?.date ? <Field label="Requested date">{[data.request.requestedChanges.date, data.request.requestedChanges.startTime].filter(Boolean).join(" at ")}</Field> : null}
              {data.request?.requestedChanges?.travelers ? <Field label="Requested travellers">{travellerSummary(data.request.requestedChanges.travelers)}</Field> : null}
              <Field label="Customer reason">{data.request?.customerReason}</Field>
              {data.request?.customerNotes ? <Field label="Customer notes"><span style={{ whiteSpace: "pre-wrap" }}>{data.request.customerNotes}</span></Field> : null}
              {data.request?.decision?.customerFacingReason ? <Field label="Message sent to customer">{data.request.decision.customerFacingReason}</Field> : null}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h3 className="h6">Booking</h3>
              {booking ? (
                <>
                  <Field label="Reference">{booking.bookingReference}</Field>
                  <Field label="Customer">{`${booking.customer?.firstName || ""} ${booking.customer?.lastName || ""}`.trim()}{booking.customer?.email ? <small className="d-block text-muted">{booking.customer.email}</small> : null}</Field>
                  <Field label="Tour">{booking.tour?.productTitle}{booking.tour?.travelDate ? ` · ${booking.tour.travelDate}` : ""}</Field>
                  <Field label="Payment"><PaymentBadge status={booking.status?.payment} /></Field>
                  <Field label="Supplier confirmation"><SupplierBadge status={booking.status?.supplier} /></Field>
                  <Field label="Supplier change for this request">{statusWords(data.supplier?.syncStatus)}</Field>
                </>
              ) : <p className="text-muted mb-0">Booking details are not available.</p>}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h3 className="h6">Finance evidence</h3>
              <Table size="sm" className="mb-3 finance-evidence-table">
                <tbody>
                  <tr><th scope="row">Refund</th><td>{evidence.refund?.required ? statusWords(evidence.refund.status) : "Not required"}</td></tr>
                  <tr><th scope="row">Estimated refund</th><td>{money(evidence.refund?.estimatedAmount, currency)}</td></tr>
                  <tr><th scope="row">Eligible refund</th><td>{money(evidence.refund?.eligibleAmount, currency)}</td></tr>
                  <tr><th scope="row">Approved refund</th><td>{money(evidence.refund?.approvedAmount, currency)}</td></tr>
                  <tr><th scope="row">Refunded (confirmed)</th><td>{money(evidence.refund?.confirmedRefundedAmount, currency)}</td></tr>
                  <tr><th scope="row">Cancellation fee</th><td>{money(evidence.refund?.cancellationFee, currency)}</td></tr>
                  <tr><th scope="row">Additional payment</th><td>{evidence.additionalPayment?.required ? statusWords(evidence.additionalPayment.status) : "Not required"}</td></tr>
                  <tr><th scope="row">Price difference</th><td>{money(evidence.priceAdjustment?.difference, currency)}</td></tr>
                </tbody>
              </Table>
              {evidence.invoice ? (
                <>
                  <small className="text-muted d-block">Invoice {evidence.invoice.invoiceNumber} · {statusWords(evidence.invoice.paymentStatus)}</small>
                  <small className="d-block">Total {money(evidence.invoice.total, currency)} · Paid {money(evidence.invoice.amountPaid, currency)} · Refunded {money(evidence.invoice.amountRefunded, currency)} · Balance {money(evidence.invoice.balanceDue, currency)}</small>
                </>
              ) : <small className="text-muted">No invoice recorded for this booking.</small>}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-3 mt-1">
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h3 className="h6">Tour Operations notes</h3>
              {(data.operations?.notes || []).length ? (
                <ListGroup variant="flush">
                  {[...data.operations.notes].reverse().map((note) => (
                    <ListGroup.Item key={note.id || `${note.at}-${note.actorId}`}>
                      <div style={{ whiteSpace: "pre-wrap" }}>{note.text}</div>
                      <small className="text-muted">{formatDateTime(note.at)} · {statusWords(note.actorRole)} {note.actorId}</small>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              ) : <p className="text-muted mb-0">No internal notes.</p>}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h3 className="h6">Operational history</h3>
              {(data.operations?.history || []).length ? (
                <ListGroup variant="flush" as="ol">
                  {data.operations.history.map((entry) => (
                    <ListGroup.Item as="li" key={entry.id || `${entry.at}-${entry.action}`}>
                      <div>{historyText(entry)}</div>
                      {entry.text && entry.action !== "note_added" ? <small className="d-block">{entry.text}</small> : null}
                      <small className="text-muted">{formatDateTime(entry.at)} · {statusWords(entry.actorRole)} {entry.actorId}</small>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              ) : <p className="text-muted mb-0">No recorded operational history.</p>}
              <h4 className="h6 mt-4">All activity on this request</h4>
              {(data.auditTrail || []).length ? (
                <ListGroup variant="flush" as="ol">
                  {data.auditTrail.map((row, index) => (
                    <ListGroup.Item as="li" key={`${row.at}-${index}`} className="small">
                      {statusWords(row.action)} <span className="text-muted">· {statusWords(row.actorRole)} · {formatDateTime(row.at)}</span>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              ) : <p className="text-muted small mb-0">No recorded activity.</p>}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default FinanceEscalationDetailsPage;
