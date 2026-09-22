import { useEffect, useState } from "react";
import { Badge, Button, Card, Form, Modal, Table } from "react-bootstrap";
import {
  createServiceCompletion,
  fetchServiceCompletionDetail,
  fetchServiceCompletionReview,
  fetchServiceCompletions,
  previewServiceCompletionRevenue,
  verifyServiceCompletion,
} from "../../api/adminApi";

const label = (value = "") => String(value || "UNKNOWN").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const emptyForm = { bookingReference: "", serviceKey: "", serviceName: "", completedAt: "", status: "COMPLETION_PENDING", evidenceSource: "LOCAL_OPERATOR_CONFIRMATION", reason: "", notes: "" };

export default function AdminServiceCompletionPage() {
  const [state, setState] = useState({ loading: true, error: "", rows: [] });
  const [filters, setFilters] = useState({ status: "", search: "" });
  const [form, setForm] = useState(emptyForm);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [reviewReference, setReviewReference] = useState("");
  const [review, setReview] = useState(null);
  const [confirmation, setConfirmation] = useState({ completedAt: "", note: "" });

  const load = async (nextFilters = filters) => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try { setState({ loading: false, error: "", rows: await fetchServiceCompletions(nextFilters) }); }
    catch (error) { setState({ loading: false, error: error.message || "Unable to load service evidence.", rows: [] }); }
  };
  useEffect(() => { load(); }, []);

  const submit = async (event) => {
    event.preventDefault();
    try { await createServiceCompletion({ ...form, completedAt: form.completedAt || undefined }); setForm(emptyForm); await load(); }
    catch (error) { setState((current) => ({ ...current, error: error.message || "Unable to record completion evidence." })); }
  };
  const inspect = async (row) => {
    try { setSelected(await fetchServiceCompletionDetail(row._id)); setPreview(null); }
    catch (error) { setState((current) => ({ ...current, error: error.message || "Unable to load completion detail." })); }
  };
  const reviewArrival = async (event) => {
    event.preventDefault();
    try { setReview(await fetchServiceCompletionReview(reviewReference)); setConfirmation({ completedAt: "", note: "" }); }
    catch (error) { setState((current) => ({ ...current, error: error.message || "Unable to review Bókun operational evidence." })); }
  };
  const confirmCompletion = async (event) => {
    event.preventDefault();
    try {
      const booking = review.booking;
      await createServiceCompletion({ bookingReference: booking.bookingReference, serviceKey: booking.bokunProductId, serviceName: booking.productTitle, serviceDate: booking.travelDate, status: "COMPLETED", evidenceSource: "ADMIN_CONFIRMATION", externalStatus: booking.bokunActivityStatus, externalReference: booking.bokunOperationalEvidence?.activityBookingId || "", completedAt: confirmation.completedAt, reason: confirmation.note, notes: "Bókun ARRIVED retained as supporting operational evidence." });
      setReview(await fetchServiceCompletionReview(booking.bookingReference));
      await load();
    } catch (error) { setState((current) => ({ ...current, error: error.message || "Unable to confirm completion." })); }
  };
  const previewRevenue = async () => {
    try { setPreview(await previewServiceCompletionRevenue(selected.completion._id)); }
    catch (error) { setState((current) => ({ ...current, error: error.message || "Unable to preview revenue recognition." })); }
  };

  return <main className="admin-page-container">
    <header className="d-flex justify-content-between align-items-start mb-4"><div><p className="text-muted mb-1">Business Accounting / Operations</p><h1>Service Completions</h1><p className="text-muted mb-0">Operational proof of delivery. Booking, payment, completion, and revenue remain separate states.</p></div><Button variant="outline-secondary" onClick={() => load()}>Refresh</Button></header>
    {state.error ? <div className="alert alert-danger">{state.error}</div> : null}
    <Card className="mb-4"><Card.Body><h2 className="h5">Admin Completion Review</h2><Form className="d-flex gap-2" onSubmit={reviewArrival}><Form.Control required placeholder="Booking or Bókun confirmation reference" value={reviewReference} onChange={(event) => setReviewReference(event.target.value)} /><Button type="submit" variant="outline-primary">Review Bókun Arrival</Button></Form>
      {review ? <div className="mt-4"><div className="row g-3"><div className="col-md-3"><strong>Booking Status</strong><div>{label(review.booking.bookingStatus)}</div></div><div className="col-md-3"><strong>Payment State</strong><div>{label(review.booking.paymentState)}</div></div><div className="col-md-3"><strong>Bókun Activity Status</strong><div>{label(review.booking.bokunActivityStatus)}</div></div><div className="col-md-3"><strong>Service Completion Status</strong><div>{label(review.serviceCompletionStatus)}</div></div></div>
        {review.booking.bokunActivityStatus === "ARRIVED" && review.serviceCompletionStatus === "NOT_COMPLETED" ? <Form className="row g-3 mt-2" onSubmit={confirmCompletion}><div className="col-md-6"><Form.Label>Booking reference</Form.Label><Form.Control readOnly value={review.booking.bookingReference} /></div><div className="col-md-6"><Form.Label>Customer</Form.Label><Form.Control readOnly value={`${review.booking.customer?.firstName || ""} ${review.booking.customer?.lastName || ""}`.trim()} /></div><div className="col-md-6"><Form.Label>Service/component</Form.Label><Form.Control readOnly value={review.booking.productTitle || review.booking.bokunProductId} /></div><div className="col-md-6"><Form.Label>Scheduled service date</Form.Label><Form.Control readOnly value={review.booking.travelDate || ""} /></div><div className="col-md-6"><Form.Label>Evidence source</Form.Label><Form.Control readOnly value={`${review.booking.bokunOperationalEvidence?.source || "BOKUN_ACTIVITY_BOOKING"}: ${review.booking.bokunOperationalEvidence?.sourceField || "activityBookings[].status"}`} /></div><div className="col-md-6"><Form.Label>Actual completion date/time</Form.Label><Form.Control required type="datetime-local" value={confirmation.completedAt} onChange={(event) => setConfirmation({ ...confirmation, completedAt: event.target.value })} /></div><div className="col-12"><Form.Label>Admin note</Form.Label><Form.Control required as="textarea" rows={2} value={confirmation.note} onChange={(event) => setConfirmation({ ...confirmation, note: event.target.value })} /></div><div className="col-12"><Button type="submit">Confirm Completion</Button></div></Form> : <div className="alert alert-secondary mt-3 mb-0">Completion confirmation requires Bókun ARRIVED evidence and an explicit admin-entered completion time.</div>}</div> : null}
    </Card.Body></Card>
    <Card className="mb-4"><Card.Body><h2 className="h5">Record Component Evidence</h2><Form className="row g-3" onSubmit={submit}>
      <div className="col-md-3"><Form.Label>Booking reference</Form.Label><Form.Control required value={form.bookingReference} onChange={(event) => setForm({ ...form, bookingReference: event.target.value })} /></div>
      <div className="col-md-3"><Form.Label>Service/component key</Form.Label><Form.Control required value={form.serviceKey} onChange={(event) => setForm({ ...form, serviceKey: event.target.value })} /></div>
      <div className="col-md-3"><Form.Label>Service name</Form.Label><Form.Control value={form.serviceName} onChange={(event) => setForm({ ...form, serviceName: event.target.value })} /></div>
      <div className="col-md-3"><Form.Label>Actual completion time</Form.Label><Form.Control type="datetime-local" value={form.completedAt} onChange={(event) => setForm({ ...form, completedAt: event.target.value })} /></div>
      <div className="col-md-3"><Form.Label>Workflow state</Form.Label><Form.Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="COMPLETION_PENDING">Completion pending verification</option><option value="NO_SHOW">No-show</option><option value="CANCELLED">Cancelled</option><option value="NEEDS_REVIEW">Needs review</option></Form.Select></div>
      <div className="col-md-3"><Form.Label>Evidence source</Form.Label><Form.Select value={form.evidenceSource} onChange={(event) => setForm({ ...form, evidenceSource: event.target.value })}><option>LOCAL_OPERATOR_CONFIRMATION</option><option>DRIVER_CONFIRMATION</option><option>GUIDE_CONFIRMATION</option><option>OTHER_VERIFIED_SOURCE</option></Form.Select></div>
      <div className="col-md-6"><Form.Label>Operational reason</Form.Label><Form.Control required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></div>
      <div className="col-12"><Form.Label>Operational notes</Form.Label><Form.Control as="textarea" rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></div>
      <div className="col-12"><Button type="submit">Record Evidence</Button></div>
    </Form></Card.Body></Card>
    <Card><Card.Body><div className="d-flex flex-wrap gap-2 justify-content-between mb-3"><h2 className="h5 mb-0">Completion Evidence</h2><Form className="d-flex gap-2" onSubmit={(event) => { event.preventDefault(); load(); }}><Form.Select aria-label="Filter completion status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">All states</option><option>COMPLETION_PENDING</option><option>COMPLETED</option><option>NEEDS_REVIEW</option><option>CANCELLED</option><option>NO_SHOW</option></Form.Select><Form.Control placeholder="Booking or service" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /><Button type="submit">Filter</Button></Form></div>
      <Table responsive hover><thead><tr><th>Booking</th><th>Service</th><th>Service date</th><th>Completion</th><th>Actual time</th><th>Evidence</th><th>Verified by</th><th>Revenue</th><th /></tr></thead><tbody>{state.rows.map((row) => <tr key={row._id}><td>{row.bookingReference}</td><td>{row.serviceName || row.serviceKey}</td><td>{row.serviceDate || "-"}</td><td><Badge bg={row.status === "COMPLETED" ? "success" : "secondary"}>{label(row.status)}</Badge></td><td>{row.completedAt ? new Date(row.completedAt).toLocaleString() : "-"}</td><td>{label(row.evidenceSource)}</td><td>{row.verifiedBy || "-"}</td><td>{label(row.revenueStatus || "NOT_POSTED")}</td><td><Button size="sm" variant="outline-primary" onClick={() => inspect(row)}>Inspect</Button></td></tr>)}{!state.loading && !state.rows.length ? <tr><td colSpan="9" className="text-center text-muted py-4">No completion evidence matches this view.</td></tr> : null}</tbody></Table>
    </Card.Body></Card>
    <Modal show={Boolean(selected)} onHide={() => setSelected(null)} size="lg"><Modal.Header closeButton><Modal.Title>Completion Evidence</Modal.Title></Modal.Header><Modal.Body>{selected ? <><dl className="row"><dt className="col-sm-4">Booking</dt><dd className="col-sm-8">{selected.completion.bookingReference}</dd><dt className="col-sm-4">Service</dt><dd className="col-sm-8">{selected.completion.serviceName || selected.completion.serviceKey}</dd><dt className="col-sm-4">Completion state</dt><dd className="col-sm-8">{label(selected.completion.status)}</dd><dt className="col-sm-4">Evidence source</dt><dd className="col-sm-8">{label(selected.completion.evidenceSource)}</dd><dt className="col-sm-4">Verification</dt><dd className="col-sm-8">{selected.completion.verifiedBy || "Awaiting authorized verification"}</dd><dt className="col-sm-4">Revenue state</dt><dd className="col-sm-8">{label(selected.completion.revenueStatus || "NOT_POSTED")}</dd></dl>{selected.completion.revenueBlockers?.length ? <div className="alert alert-warning">{selected.completion.revenueBlockers.join(", ")}</div> : null}{preview ? <Card bg="light"><Card.Body><strong>Revenue preview only</strong><div>{preview.eligibility}</div><div>{preview.blockReason || preview.activationBlockers?.join(", ") || "No blockers"}</div><code>{preview.journalLines?.map((line) => `${line.accountCode}: Dr ${line.debit} / Cr ${line.credit}`).join("; ") || "No journal preview"}</code></Card.Body></Card> : null}</> : null}</Modal.Body><Modal.Footer><Button variant="outline-primary" onClick={previewRevenue}>Preview revenue</Button><Button variant="secondary" onClick={() => setSelected(null)}>Close</Button></Modal.Footer></Modal>
  </main>;
}
