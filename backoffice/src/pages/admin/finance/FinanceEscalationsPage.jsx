import { useEffect, useRef, useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsSearch } from "react-icons/bs";
import { Link, useSearchParams } from "react-router-dom";
import PageHeader from "../../../components/admin/PageHeader";
import Loader from "../../../../../shared/src/components/common/Loader";
import { formatDateTime } from "../../../components/admin/AdminDataWidgets";
import { fetchFinanceEscalations } from "../../../api/financeEscalationsApi";
import {
  CATEGORY_LABELS,
  REQUEST_TYPE_LABELS,
  categoryLabel,
  requestStateLabel,
  requestStateTone,
  requestTypeLabel,
  statusWords
} from "../../../config/tourOperations";
import { EmptyState, ToneBadge, TourAdminPagination, tourAdminErrorMessage } from "../../../components/admin/tourAdmin/TourAdminUi";

const PAGE_SIZE = 25;
const FILTER_KEYS = ["scope", "category", "type", "bookingReference", "requestReference"];
const readFilters = (searchParams) => Object.fromEntries(FILTER_KEYS.map((key) => [key, searchParams.get(key) || ""]));

// Requests Tour Operations escalated to Finance. Read-only: reviewing here changes nothing; any action
// is taken in the existing Back Office request and Finance screens.
const FinanceEscalationsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
  const [draft, setDraft] = useState(readFilters(searchParams));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const latest = useRef(0);
  const queryKey = searchParams.toString();

  useEffect(() => {
    setDraft(readFilters(searchParams));
    const call = ++latest.current;
    setLoading(true);
    setError("");
    fetchFinanceEscalations({ ...readFilters(searchParams), page, limit: PAGE_SIZE })
      .then((result) => { if (call === latest.current) setData(result); })
      .catch((err) => { if (call === latest.current) { setData(null); setError(tourAdminErrorMessage(err, "Finance escalations could not be loaded.")); } })
      .finally(() => { if (call === latest.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, reloadKey]);

  const apply = (event) => {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = String(draft[key] || "").trim();
      if (value) next.set(key, value);
    }
    setSearchParams(next);
  };

  const goToPage = (nextPage) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(nextPage));
    setSearchParams(next);
  };

  const items = data?.items || [];
  const allEscalated = searchParams.get("scope") === "all";

  return (
    <div className="finance-escalations">
      <PageHeader
        eyebrow="Booking Accounting"
        title="Finance Escalations"
        description="Customer requests Tour Operations escalated to Finance. Review only: nothing here refunds, charges, cancels or re-invoices."
        actions={<Button variant="outline-secondary" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}><BsArrowClockwise aria-hidden="true" /> Refresh</Button>}
      />

      <Card className="surface-card mt-3">
        <Card.Body>
          <Form onSubmit={apply} className="finance-escalation-filters" aria-label="Filter Finance escalations">
            <Row className="g-2 align-items-end">
              <Col sm={6} lg={3}>
                <Form.Group controlId="finance-escalations-scope">
                  <Form.Label className="small">Show</Form.Label>
                  <Form.Select size="sm" value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value })}>
                    <option value="">Awaiting Finance</option>
                    <option value="all">All escalated to Finance</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col sm={6} lg={3}>
                <Form.Group controlId="finance-escalations-category">
                  <Form.Label className="small">Category</Form.Label>
                  <Form.Select size="sm" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
                    <option value="">All</option>
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col sm={6} lg={3}>
                <Form.Group controlId="finance-escalations-type">
                  <Form.Label className="small">Customer request type</Form.Label>
                  <Form.Select size="sm" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>
                    <option value="">All</option>
                    {Object.entries(REQUEST_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col sm={6} lg={3}>
                <Form.Group controlId="finance-escalations-booking">
                  <Form.Label className="small">Booking reference</Form.Label>
                  <Form.Control size="sm" value={draft.bookingReference} maxLength={64} onChange={(event) => setDraft({ ...draft, bookingReference: event.target.value })} />
                </Form.Group>
              </Col>
              <Col sm={6} lg={3}>
                <Form.Group controlId="finance-escalations-request">
                  <Form.Label className="small">Request reference</Form.Label>
                  <Form.Control size="sm" value={draft.requestReference} maxLength={64} onChange={(event) => setDraft({ ...draft, requestReference: event.target.value })} />
                </Form.Group>
              </Col>
              <Col className="d-flex gap-2 justify-content-end">
                <Button type="button" variant="outline-secondary" size="sm" onClick={() => setSearchParams(new URLSearchParams())}>Reset</Button>
                <Button type="submit" size="sm" className="premium-btn text-white" disabled={loading}><BsSearch aria-hidden="true" /> Apply</Button>
              </Col>
            </Row>
          </Form>
        </Card.Body>
      </Card>

      <Card className="surface-card mt-3">
        <Card.Body>
          {error ? <div className="alert alert-danger" role="alert">{error}</div> : null}
          {loading ? <Loader message="Loading Finance escalations..." /> : null}
          {!loading && !error && !items.length ? (
            <EmptyState>{allEscalated ? "No requests have been escalated to Finance." : "No requests are waiting for Finance."}</EmptyState>
          ) : null}
          {!loading && items.length ? (
            <>
              <Table responsive hover className="align-middle finance-escalations-table">
                <thead>
                  <tr>
                    <th scope="col">Booking</th>
                    <th scope="col">Request</th>
                    <th scope="col">Category</th>
                    <th scope="col">Submitted</th>
                    <th scope="col">State</th>
                    <th scope="col">Escalation reason</th>
                    <th scope="col">Escalated</th>
                    <th scope="col">Refund</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.booking?.bookingReference || "-"}
                        <small className="d-block text-muted">{`${item.booking?.customer?.firstName || ""} ${item.booking?.customer?.lastName || ""}`.trim()}</small>
                        <small className="d-block text-muted">{item.booking?.tour?.productTitle}{item.booking?.tour?.travelDate ? ` · ${item.booking.tour.travelDate}` : ""}</small>
                      </td>
                      <td>
                        <Link to={`/admin/finance/escalations/${item.id}`}>{item.requestReference || item.id}</Link>
                        <small className="d-block text-muted">{requestTypeLabel(item.type)}</small>
                      </td>
                      <td>{categoryLabel(item.category)}</td>
                      <td>{formatDateTime(item.submittedAt)}</td>
                      <td><ToneBadge tone={requestStateTone(item.state)}>{requestStateLabel(item.state)}</ToneBadge></td>
                      <td className="text-break">{item.escalation ? (item.escalation.reason || <span className="text-muted">No reason recorded</span>) : <span className="text-muted">Not recorded</span>}</td>
                      <td>{item.escalation?.at ? formatDateTime(item.escalation.at) : <span className="text-muted">Not recorded</span>}</td>
                      <td>{item.finance?.refundRequired ? statusWords(item.finance.refundStatus) : "Not required"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <TourAdminPagination page={data.page} limit={data.limit} total={data.total} onPage={goToPage} disabled={loading} label="escalations" />
            </>
          ) : null}
        </Card.Body>
      </Card>
    </div>
  );
};

export default FinanceEscalationsPage;
