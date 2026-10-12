import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Col, Form, ListGroup, Modal, Row } from "react-bootstrap";
import { BsArrowClockwise, BsArrowLeft } from "react-icons/bs";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../../../components/admin/PageHeader";
import Loader from "../../../../../shared/src/components/common/Loader";
import useAuth from "../../../../../shared/src/hooks/useAuth";
import { formatDateTime } from "../../../components/admin/AdminDataWidgets";
import { addTourRequestNote, fetchTourRequest, setTourRequestCategory, transitionTourRequest } from "../../../api/tourOperationsApi";
import {
  CATEGORY_LABELS,
  TOUR_PERMISSIONS,
  categoryLabel,
  hasPermission,
  requestStateLabel,
  requestStateTone,
  requestTypeLabel,
  statusWords,
  transitionActionLabel,
  travellerSummary
} from "../../../config/tourOperations";
import { AttentionBadge, PaymentBadge, SupplierBadge, ToneBadge, tourAdminErrorMessage } from "../../../components/admin/tourAdmin/TourAdminUi";

const NOTE_LIMIT = 2000;

const Field = ({ label, children }) => (
  <div className="mb-3">
    <small className="text-muted d-block">{label}</small>
    <div>{children || "-"}</div>
  </div>
);

const historyText = (entry) => {
  if (entry.action === "note_added") return "Added an internal note";
  if (entry.action === "category_changed") return `Set category to ${categoryLabel(entry.category)}`;
  if (entry.action === "escalated") return `Escalated to ${entry.escalatedTo === "FINANCE" ? "Finance" : "supplier action"} (${requestStateLabel(entry.fromState)} → ${requestStateLabel(entry.toState)})`;
  if (entry.action === "state_changed") return `${requestStateLabel(entry.fromState)} → ${requestStateLabel(entry.toState)}`;
  return statusWords(entry.action);
};

// Internal handling of a customer request. The only actions offered are the ones the Tour Operations API
// supports (notes, category, internal state). Refunds, payments, supplier changes and the customer's
// decision stay with Finance and the Back Office, so there are no controls for them here.
const TourAdminRequestDetailsPage = () => {
  const { requestId } = useParams();
  const { user } = useAuth();
  const canProcess = hasPermission(user, TOUR_PERMISSIONS.REQUESTS_PROCESS);
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [pending, setPending] = useState(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const data = await fetchTourRequest(requestId);
      setRequest(data);
      setCategoryDraft(data?.operations?.category || "");
    } catch (err) {
      setRequest(null);
      setError(tourAdminErrorMessage(err, "This request could not be loaded."));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [requestId]);

  useEffect(() => { load(); }, [load]);

  // One action at a time; the ref also blocks a second click before React re-renders.
  // Returns true on success, otherwise the HTTP status of the failure (0 when unknown).
  const runAction = async (action, successText) => {
    if (busyRef.current) return 0;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: "success", text: successText });
      await load({ quiet: true });
      return true;
    } catch (err) {
      setMessage({ tone: err?.status === 409 ? "warning" : "danger", text: tourAdminErrorMessage(err, "The change could not be saved.") });
      if (err?.status === 409) await load({ quiet: true });
      return Number(err?.status || 0);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const submitNote = async (event) => {
    event.preventDefault();
    const text = noteText.trim();
    if (!text) return;
    if ((await runAction(() => addTourRequestNote(requestId, text), "Internal note added.")) === true) setNoteText("");
  };

  const saveCategory = (event) => {
    event.preventDefault();
    runAction(
      () => setTourRequestCategory(requestId, { category: categoryDraft, expectedVersion: request.operations.version }),
      "Category updated."
    );
  };

  const openTransition = (option) => {
    setReason("");
    setMessage(null);
    setPending(option);
  };

  const confirmTransition = async () => {
    const option = pending;
    const result = await runAction(
      () => transitionTourRequest(requestId, { toState: option.toState, expectedVersion: request.operations.version, reason: reason.trim() }),
      `${transitionActionLabel(option)}: done. Only the internal Tour Operations state changed.`
    );
    // A conflict means the request moved on: close and show the reloaded options.
    if (result === true || result === 409) setPending(null);
  };

  const back = <Button as={Link} to="/admin/tour-admin/requests" variant="outline-secondary"><BsArrowLeft aria-hidden="true" /> All requests</Button>;

  if (loading) return <Loader message="Loading request..." />;
  if (!request) {
    return (
      <div className="tour-admin-request-details">
        <PageHeader eyebrow="Tour Admin" title="Customer request" actions={back} />
        <div className="alert alert-danger mt-3" role="alert">{error}</div>
      </div>
    );
  }

  const operations = request.operations || {};
  const booking = request.booking;
  const reasonOk = !pending?.reasonRequired || reason.trim().length >= 3;

  return (
    <div className="tour-admin-request-details">
      <PageHeader
        eyebrow="Tour Admin · Customer request"
        title={request.requestReference}
        description={`${requestTypeLabel(request.type)} for ${booking?.bookingReference || "booking"}`}
        actions={<div className="d-flex gap-2">{back}<Button variant="outline-secondary" onClick={() => load()} disabled={busy}><BsArrowClockwise aria-hidden="true" /> Refresh</Button></div>}
      />

      {request.notice ? <div className="alert alert-info small mt-3" role="note">{request.notice}</div> : null}
      {message ? <div className={`alert alert-${message.tone} mt-3`} role={message.tone === "success" ? "status" : "alert"}>{message.text}</div> : null}

      <Row className="g-3 mt-1">
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h3 className="h6">Request</h3>
              <Field label="Operations state"><ToneBadge tone={requestStateTone(operations.state)}>{requestStateLabel(operations.state)}</ToneBadge></Field>
              <Field label="Category">{categoryLabel(operations.category)}{operations.categorySource === "request_type" ? <small className="text-muted"> (from request type)</small> : null}</Field>
              <Field label="Customer decision (Back Office)">{statusWords(request.customerStatus)}</Field>
              <Field label="Received">{formatDateTime(request.createdAt)}</Field>
              {request.customerFacingDecision ? <Field label="Message sent to customer">{request.customerFacingDecision}</Field> : null}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h3 className="h6">What the customer asked for</h3>
              <Field label="Current">{[request.original?.date, request.original?.startTime].filter(Boolean).join(" at ")}{request.original?.optionTitle ? ` · ${request.original.optionTitle}` : ""}</Field>
              <Field label="Current travellers">{travellerSummary(request.original?.travelers)}</Field>
              {request.requestedChanges?.date || request.requestedChanges?.startTime ? (
                <Field label="Requested date">{[request.requestedChanges.date, request.requestedChanges.startTime].filter(Boolean).join(" at ")}</Field>
              ) : null}
              {request.requestedChanges?.travelers ? <Field label="Requested travellers">{travellerSummary(request.requestedChanges.travelers)}</Field> : null}
              <Field label="Customer reason">{request.customerReason}</Field>
              {request.customerNotes ? <Field label="Customer notes"><span style={{ whiteSpace: "pre-wrap" }}>{request.customerNotes}</span></Field> : null}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h3 className="h6">Booking</h3>
              {booking ? (
                <>
                  <Field label="Reference"><Link to={`/admin/tour-admin/bookings/${encodeURIComponent(booking.bookingReference)}`}>{booking.bookingReference}</Link></Field>
                  <Field label="Tour">{booking.tour?.productTitle}{booking.tour?.travelDate ? ` · ${booking.tour.travelDate}` : ""}</Field>
                  <Field label="Customer">{`${booking.customer?.firstName || ""} ${booking.customer?.lastName || ""}`.trim()}</Field>
                  <Field label="Attention"><AttentionBadge booking={booking} /></Field>
                  <Field label="Payment"><PaymentBadge status={booking.status?.payment} /></Field>
                  <Field label="Supplier confirmation"><SupplierBadge status={booking.status?.supplier} /></Field>
                </>
              ) : <p className="text-muted mb-0">Booking details are not available.</p>}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h3 className="h6">Supplier and Finance status</h3>
              <Field label="Supplier change">{statusWords(request.supplier?.syncStatus)}</Field>
              <Field label="Refund">{request.finance?.refundRequired ? statusWords(request.finance.refundStatus) : "Not required"}</Field>
              <Field label="Additional payment">{request.finance?.additionalPaymentRequired ? statusWords(request.finance.additionalPaymentStatus) : "Not required"}</Field>
              <small className="text-muted">Status only. Supplier changes, refunds and payments are carried out by the Back Office and Finance.</small>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {canProcess ? (
        <Card className="surface-card mt-3">
          <Card.Body>
            <h3 className="h6">Tour Operations actions</h3>
            <p className="small text-muted">These change only the internal handling of this request. They do not cancel, reschedule, refund or charge anything.</p>
            <div className="d-flex flex-wrap gap-2 mb-3" role="group" aria-label="Move this request">
              {(operations.allowedTransitions || []).map((option) => (
                <Button
                  key={option.toState}
                  variant={option.escalatesTo ? "outline-warning" : option.toState === "REJECTED" ? "outline-danger" : "outline-primary"}
                  size="sm"
                  disabled={busy}
                  onClick={() => openTransition(option)}
                >
                  {transitionActionLabel(option)}
                </Button>
              ))}
              {!(operations.allowedTransitions || []).length ? <small className="text-muted">No state changes are available.</small> : null}
            </div>
            <Form onSubmit={saveCategory} className="d-flex flex-wrap align-items-end gap-2 mb-3">
              <Form.Group controlId="tour-request-category">
                <Form.Label className="small">Category</Form.Label>
                <Form.Select size="sm" value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} disabled={busy}>
                  {Object.entries(CATEGORY_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                </Form.Select>
              </Form.Group>
              <Button type="submit" size="sm" variant="outline-secondary" disabled={busy || !categoryDraft || categoryDraft === operations.category}>Save category</Button>
            </Form>
            <Form onSubmit={submitNote}>
              <Form.Group controlId="tour-request-note">
                <Form.Label className="small">Internal note</Form.Label>
                <Form.Control as="textarea" rows={3} maxLength={NOTE_LIMIT} value={noteText} onChange={(event) => setNoteText(event.target.value)} disabled={busy} placeholder="Visible to Tour Operations and the Back Office, never to the customer." />
                <Form.Text>{noteText.length}/{NOTE_LIMIT}</Form.Text>
              </Form.Group>
              <Button type="submit" size="sm" className="premium-btn text-white mt-2" disabled={busy || !noteText.trim()}>{busy ? "Saving…" : "Add note"}</Button>
            </Form>
          </Card.Body>
        </Card>
      ) : null}

      <Row className="g-3 mt-1">
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h3 className="h6">Internal notes</h3>
              {(operations.notes || []).length ? (
                <ListGroup variant="flush">
                  {[...operations.notes].reverse().map((note) => (
                    <ListGroup.Item key={note.id || `${note.at}-${note.actorId}`}>
                      <div style={{ whiteSpace: "pre-wrap" }}>{note.text}</div>
                      <small className="text-muted">{formatDateTime(note.at)} · {statusWords(note.actorRole)} {note.actorId}</small>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              ) : <p className="text-muted mb-0">No internal notes yet.</p>}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h3 className="h6">Tour Operations history</h3>
              {(operations.history || []).length ? (
                <ListGroup variant="flush" as="ol">
                  {operations.history.map((entry) => (
                    <ListGroup.Item as="li" key={entry.id || `${entry.at}-${entry.action}`}>
                      <div>{historyText(entry)}</div>
                      <small className="text-muted">{formatDateTime(entry.at)} · {statusWords(entry.actorRole)} {entry.actorId}</small>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              ) : <p className="text-muted mb-0">No Tour Operations activity yet.</p>}
              <h4 className="h6 mt-4">All activity on this request</h4>
              {(request.auditTrail || []).length ? (
                <ListGroup variant="flush" as="ol">
                  {request.auditTrail.map((row, index) => (
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

      <Modal show={Boolean(pending)} onHide={() => (busy ? null : setPending(null))} centered aria-labelledby="tour-transition-title">
        <Modal.Header closeButton={!busy}>
          <Modal.Title id="tour-transition-title" className="h5">{pending ? transitionActionLabel(pending) : ""}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {message && message.tone !== "success" ? <div className={`alert alert-${message.tone} small`} role="alert">{message.text}</div> : null}
          <p>
            Move this request from <strong>{requestStateLabel(operations.state)}</strong> to <strong>{pending ? requestStateLabel(pending.toState) : ""}</strong>.
          </p>
          <p className="small text-muted">
            This only changes the internal Tour Operations state{pending?.escalatesTo === "FINANCE" ? " and flags the request for Finance" : pending?.escalatesTo === "SUPPLIER" ? " and flags the request for supplier action" : ""}.
            Nothing is cancelled, rescheduled, refunded or charged, and the customer is not contacted.
          </p>
          <Form.Group controlId="tour-transition-reason">
            <Form.Label className="small">{pending?.reasonRequired ? "Reason (required)" : "Reason (optional)"}</Form.Label>
            <Form.Control as="textarea" rows={3} maxLength={NOTE_LIMIT} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} isInvalid={Boolean(pending?.reasonRequired) && reason.length > 0 && !reasonOk} />
            <Form.Control.Feedback type="invalid">Give a short reason (at least 3 characters).</Form.Control.Feedback>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
          <Button className="premium-btn text-white" onClick={confirmTransition} disabled={busy || !reasonOk}>{busy ? "Saving…" : "Confirm"}</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default TourAdminRequestDetailsPage;
