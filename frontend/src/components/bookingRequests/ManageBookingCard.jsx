import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Form, Modal, Spinner } from "react-bootstrap";
import {
  BsArrowRepeat,
  BsCalendar2Date,
  BsPeople,
  BsReceipt,
  BsXCircle
} from "react-icons/bs";
import {
  cancelCustomerBookingRequest,
  fetchCancellationEstimate,
  fetchCustomerBookingRequests,
  respondToBookingRequest,
  submitBookingRequest
} from "../../api/bookingRequestsApi";
import { formatCurrency, formatDate } from "../../utils/formatters";

const statusVariant = (status = "") => {
  if (["completed", "approved", "synced", "refunded"].includes(status)) return "success";
  if (["rejected", "failed", "cancelled_by_customer", "unavailable"].includes(status)) return "danger";
  return "warning";
};

const titleForType = {
  reschedule: "Change Date or Time",
  change_travelers: "Change Travelers",
  cancel_booking: "Cancel Booking"
};

const emptyRequestForm = (type, booking) => ({
  type,
  requestedDate: booking.travelDate || "",
  requestedTime: booking.startTime || "",
  adults: Number(booking.paxSummary?.adults || 0),
  children: Number(booking.paxSummary?.children || 0),
  infants: Number(booking.paxSummary?.infants || 0),
  childAges: "",
  reason: "",
  notes: "",
  cancellationReason: "change_of_plans",
  cancellationConfirmed: false
});

const ManageBookingCard = ({ booking }) => {
  const [customerEmail, setCustomerEmail] = useState("");
  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modalType, setModalType] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(() => emptyRequestForm("reschedule", booking));
  const [responseNotes, setResponseNotes] = useState({});
  const [cancellationEstimate, setCancellationEstimate] = useState(null);
  const [loadingEstimate, setLoadingEstimate] = useState(false);

  const currency = booking.pricingSnapshot?.currency || booking.currency || "USD";
  const canManage = booking.paymentStatus === "paid" && booking.bookingStatus !== "cancelled";
  const activeRequests = useMemo(
    () => requests.filter((request) => !["completed", "rejected", "cancelled_by_customer", "failed"].includes(request.status)),
    [requests]
  );

  const loadRequests = async () => {
    if (!customerEmail.trim()) {
      setError("Enter the booking email to securely view and manage requests.");
      return;
    }
    setLoadingRequests(true);
    setError("");
    try {
      const data = await fetchCustomerBookingRequests(booking._id, customerEmail);
      setRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      setRequests([]);
      setError(err.message || "We could not verify the booking email.");
    } finally {
      setLoadingRequests(false);
    }
  };

  const openRequestModal = (type) => {
    setError("");
    setNotice("");
    setForm(emptyRequestForm(type, booking));
    setModalType(type);
    setCancellationEstimate(null);
    if (type === "cancel_booking" && customerEmail.trim()) {
      setLoadingEstimate(true);
      void fetchCancellationEstimate(booking._id, customerEmail)
        .then((data) => setCancellationEstimate(data))
        .catch((err) => setError(err.message || "We could not calculate the cancellation estimate."))
        .finally(() => setLoadingEstimate(false));
    }
  };

  const updateForm = (name, value) => setForm((current) => ({ ...current, [name]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!customerEmail.trim()) {
      setError("Enter and verify the booking email before submitting a request.");
      return;
    }

    const travelers = {
      adults: Number(form.adults || 0),
      children: Number(form.children || 0),
      infants: Number(form.infants || 0),
      childAges: String(form.childAges || "")
        .split(",")
        .map((age) => Number(age.trim()))
        .filter((age) => Number.isInteger(age))
    };
    const payload = {
      customerEmail: customerEmail.trim(),
      type: form.type,
      customerReason: form.reason,
      customerNotes: form.notes,
      requestedChanges:
        form.type === "reschedule"
          ? { date: form.requestedDate, startTime: form.requestedTime }
          : { travelers },
      ...(form.type === "cancel_booking"
        ? {
            cancellationReason: form.cancellationReason,
            cancellationConfirmed: form.cancellationConfirmed
          }
        : {})
    };

    setSubmitting(true);
    setError("");
    try {
      const result = await submitBookingRequest(booking._id, payload);
      setModalType("");
      setNotice(`Request ${result.requestReference} was received and is awaiting review.`);
      await loadRequests();
    } catch (err) {
      setError(err.message || "We could not submit your request.");
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRequest = async (requestId) => {
    if (!window.confirm("Cancel this booking request?")) return;
    setError("");
    try {
      await cancelCustomerBookingRequest(requestId, customerEmail);
      setNotice("The request was cancelled.");
      await loadRequests();
    } catch (err) {
      setError(err.message || "We could not cancel that request.");
    }
  };

  const sendResponse = async (requestId) => {
    const notes = String(responseNotes[requestId] || "").trim();
    if (!notes) return;
    setError("");
    try {
      await respondToBookingRequest(requestId, { customerEmail, notes });
      setNotice("Your information was sent to our team.");
      setResponseNotes((current) => ({ ...current, [requestId]: "" }));
      await loadRequests();
    } catch (err) {
      setError(err.message || "We could not send your response.");
    }
  };

  if (!canManage) return null;

  return (
    <Card className="my-booking-card manage-booking-card">
      <Card.Body>
        <div className="manage-booking-header">
          <div>
            <div className="my-booking-section-head is-compact">
              <span><BsArrowRepeat /></span>
              <div>
                <h2>Manage Booking</h2>
                <p>Request a change. Our team reviews every request before supplier updates.</p>
              </div>
            </div>
          </div>
          {activeRequests.length ? <Badge bg="warning" text="dark">{activeRequests.length} active request{activeRequests.length === 1 ? "" : "s"}</Badge> : null}
        </div>

        <Form className="manage-booking-verify" onSubmit={(event) => { event.preventDefault(); loadRequests(); }}>
          <Form.Group>
            <Form.Label>Booking email</Form.Label>
            <Form.Control type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} placeholder="Enter the email used for this booking" autoComplete="email" />
          </Form.Group>
          <Button type="submit" variant="outline-primary" disabled={loadingRequests}>
            {loadingRequests ? <Spinner size="sm" /> : "Verify & View Requests"}
          </Button>
        </Form>

        {error ? <Alert variant="danger" className="mt-3 mb-0">{error}</Alert> : null}
        {notice ? <Alert variant="success" className="mt-3 mb-0">{notice}</Alert> : null}

        <div className="manage-booking-actions">
          <Button variant="outline-success" disabled={!customerEmail.trim()} onClick={() => openRequestModal("reschedule")}><BsCalendar2Date /> Change Date</Button>
          <Button variant="outline-success" disabled={!customerEmail.trim()} onClick={() => openRequestModal("change_travelers")}><BsPeople /> Change Travelers</Button>
          <Button variant="outline-danger" disabled={!customerEmail.trim()} onClick={() => openRequestModal("cancel_booking")}><BsXCircle /> Cancel Booking</Button>
        </div>

        {requests.length ? (
          <div className="manage-booking-request-list" aria-live="polite">
            <h3>Your requests</h3>
            {requests.map((request) => (
              <article className="manage-booking-request" key={request.id}>
                <div className="manage-booking-request-topline">
                  <div>
                    <strong>{request.requestReference}</strong>
                    <span>{titleForType[request.type] || request.type}</span>
                  </div>
                  <Badge bg={statusVariant(request.status)}>{String(request.status || "submitted").replaceAll("_", " ")}</Badge>
                </div>
                <p>{request.adminDecision?.customerFacingReason || "Your request is awaiting an update."}</p>
                <div className="manage-booking-request-meta">
                  <span>Supplier: {String(request.bokunSync?.status || "not_required").replaceAll("_", " ")}</span>
                  <span>Refund: {String(request.refund?.status || "not_required").replaceAll("_", " ")}</span>
                  {request.additionalPayment?.required ? <span>Additional payment required</span> : null}
                </div>
                {request.refund?.estimatedAmount > 0 ? <small>Estimated refund: {formatCurrency(request.refund.estimatedAmount, currency)}</small> : null}
                {request.status === "awaiting_customer_information" ? (
                  <div className="manage-booking-response">
                    <Form.Control value={responseNotes[request.id] || ""} onChange={(event) => setResponseNotes((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Provide the requested information" />
                    <Button size="sm" variant="success" onClick={() => sendResponse(request.id)}>Send</Button>
                  </div>
                ) : null}
                {["submitted", "under_review", "awaiting_availability_check", "awaiting_customer_information"].includes(request.status) ? <Button size="sm" variant="link" className="px-0 text-danger" onClick={() => cancelRequest(request.id)}>Cancel request</Button> : null}
              </article>
            ))}
          </div>
        ) : null}
      </Card.Body>

      <Modal show={Boolean(modalType)} onHide={() => !submitting && setModalType("")} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>{titleForType[modalType]}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {modalType === "reschedule" ? (
              <>
                <div className="request-current-details">Current: {formatDate(booking.travelDate)} {booking.startTime ? `at ${booking.startTime}` : ""}</div>
                <div className="request-field-grid">
                  <Form.Group><Form.Label>Requested date</Form.Label><Form.Control required type="date" value={form.requestedDate} onChange={(event) => updateForm("requestedDate", event.target.value)} /></Form.Group>
                  <Form.Group><Form.Label>Requested time</Form.Label><Form.Control type="time" value={form.requestedTime} onChange={(event) => updateForm("requestedTime", event.target.value)} /></Form.Group>
                </div>
              </>
            ) : null}
            {modalType === "change_travelers" ? (
              <>
                <div className="request-current-details">Current travelers: Adults {booking.paxSummary?.adults || 0}, Children {booking.paxSummary?.children || 0}, Infants {booking.paxSummary?.infants || 0}</div>
                <div className="request-field-grid request-traveler-grid">
                  <Form.Group><Form.Label>Adults</Form.Label><Form.Control min="0" type="number" value={form.adults} onChange={(event) => updateForm("adults", event.target.value)} /></Form.Group>
                  <Form.Group><Form.Label>Children</Form.Label><Form.Control min="0" type="number" value={form.children} onChange={(event) => updateForm("children", event.target.value)} /></Form.Group>
                  <Form.Group><Form.Label>Infants</Form.Label><Form.Control min="0" type="number" value={form.infants} onChange={(event) => updateForm("infants", event.target.value)} /></Form.Group>
                </div>
                {Number(form.children) > 0 ? <Form.Group className="mt-3"><Form.Label>Child ages (comma separated)</Form.Label><Form.Control value={form.childAges} onChange={(event) => updateForm("childAges", event.target.value)} placeholder="Example: 4, 8" /></Form.Group> : null}
                <small className="text-muted d-block mt-3">Estimated price differences are reviewed against live availability before approval.</small>
              </>
            ) : null}
            {modalType === "cancel_booking" ? (
              <>
                <div className="request-cancellation-summary">
                  <span>Booking total <strong>{formatCurrency(booking.amount || booking.pricingSnapshot?.finalPayable || 0, currency)}</strong></span>
                  <span>Amount paid <strong>{formatCurrency(booking.invoiceSnapshot?.amountPaid || 0, currency)}</strong></span>
                  <span>Estimated refund <strong>{loadingEstimate ? "Calculating..." : cancellationEstimate ? formatCurrency(cancellationEstimate.estimatedRefundAmount || 0, currency) : "Verify booking email"}</strong></span>
                </div>
                {cancellationEstimate?.policyReason ? <small className="text-muted d-block mb-3">{cancellationEstimate.policyReason}</small> : <small className="text-muted d-block mb-3">The final refund is calculated from the booking policy and verified payment records.</small>}
                <Form.Group><Form.Label>Cancellation reason</Form.Label><Form.Select value={form.cancellationReason} onChange={(event) => updateForm("cancellationReason", event.target.value)}><option value="change_of_plans">Change of plans</option><option value="flight_cancellation">Flight cancellation</option><option value="flight_delay">Flight delay</option><option value="medical_reason">Medical reason</option><option value="weather_concern">Weather concern</option><option value="booked_by_mistake">Booked by mistake</option><option value="duplicate_booking">Duplicate booking</option><option value="other">Other</option></Form.Select></Form.Group>
              </>
            ) : null}
            <Form.Group className="mt-3"><Form.Label>{modalType === "cancel_booking" && form.cancellationReason === "other" ? "Explain the reason" : "Reason for your request"}</Form.Label><Form.Control as="textarea" rows={3} required value={form.reason} onChange={(event) => updateForm("reason", event.target.value)} /></Form.Group>
            <Form.Group className="mt-3"><Form.Label>Optional notes</Form.Label><Form.Control as="textarea" rows={2} value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} /></Form.Group>
            {modalType === "cancel_booking" ? <Form.Check className="mt-3" type="checkbox" checked={form.cancellationConfirmed} onChange={(event) => updateForm("cancellationConfirmed", event.target.checked)} label="I understand that submitting this request does not guarantee a full refund." required /> : null}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setModalType("")} disabled={submitting}>Close</Button>
            <Button type="submit" variant={modalType === "cancel_booking" ? "danger" : "success"} disabled={submitting}>{submitting ? <Spinner size="sm" /> : <BsReceipt />} Submit Request</Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </Card>
  );
};

export default ManageBookingCard;
