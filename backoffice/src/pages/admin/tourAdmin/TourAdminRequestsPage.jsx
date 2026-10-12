import { useEffect, useRef, useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { BsArrowClockwise } from "react-icons/bs";
import { Link, useSearchParams } from "react-router-dom";
import PageHeader from "../../../components/admin/PageHeader";
import Loader from "../../../../../shared/src/components/common/Loader";
import { formatDateTime } from "../../../components/admin/AdminDataWidgets";
import { fetchTourRequests } from "../../../api/tourOperationsApi";
import {
  CATEGORY_LABELS,
  REQUEST_STATES,
  REQUEST_TYPE_LABELS,
  categoryLabel,
  requestStateLabel,
  requestStateTone,
  requestTypeLabel,
  statusWords
} from "../../../config/tourOperations";
import { EmptyState, ToneBadge, TourAdminPagination, tourAdminErrorMessage } from "../../../components/admin/tourAdmin/TourAdminUi";

const PAGE_SIZE = 25;
const FILTER_KEYS = ["state", "category", "type"];

const TourAdminRequestsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const latest = useRef(0);
  const queryKey = searchParams.toString();

  useEffect(() => {
    const call = ++latest.current;
    setLoading(true);
    setError("");
    const filters = Object.fromEntries(FILTER_KEYS.map((key) => [key, searchParams.get(key) || ""]));
    fetchTourRequests({ ...filters, page, limit: PAGE_SIZE })
      .then((result) => { if (call === latest.current) setData(result); })
      .catch((err) => { if (call === latest.current) { setData(null); setError(tourAdminErrorMessage(err, "Customer requests could not be loaded.")); } })
      .finally(() => { if (call === latest.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, reloadKey]);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setSearchParams(next);
  };

  const goToPage = (nextPage) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(nextPage));
    setSearchParams(next);
  };

  const items = data?.items || [];
  const filter = (id, label, key, options) => (
    <Col sm={6} lg={4}>
      <Form.Group controlId={id}>
        <Form.Label className="small">{label}</Form.Label>
        <Form.Select size="sm" value={searchParams.get(key) || ""} onChange={(event) => setFilter(key, event.target.value)} disabled={loading}>
          <option value="">All</option>
          {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </Form.Select>
      </Form.Group>
    </Col>
  );

  return (
    <div className="tour-admin-requests">
      <PageHeader
        eyebrow="Tour Admin"
        title="Customer Requests"
        description="Date changes, cancellations and traveller changes on website and Agent Portal bookings. Tour Operations states are internal and never execute supplier or financial changes."
        actions={<Button variant="outline-secondary" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}><BsArrowClockwise aria-hidden="true" /> Refresh</Button>}
      />

      <Card className="surface-card mt-3">
        <Card.Body>
          <Row className="g-2" role="group" aria-label="Filter customer requests">
            {filter("tour-requests-state", "Operations state", "state", REQUEST_STATES.map((state) => [state, requestStateLabel(state)]))}
            {filter("tour-requests-category", "Category", "category", Object.entries(CATEGORY_LABELS))}
            {filter("tour-requests-type", "Customer request type", "type", Object.entries(REQUEST_TYPE_LABELS))}
          </Row>
        </Card.Body>
      </Card>

      <Card className="surface-card mt-3">
        <Card.Body>
          {error ? <div className="alert alert-danger" role="alert">{error}</div> : null}
          {loading ? <Loader message="Loading customer requests..." /> : null}
          {!loading && !error && !items.length ? <EmptyState>No customer requests match these filters.</EmptyState> : null}
          {!loading && items.length ? (
            <>
              <Table responsive hover className="align-middle tour-admin-requests-table">
                <thead>
                  <tr>
                    <th scope="col">Request</th>
                    <th scope="col">Booking</th>
                    <th scope="col">Type</th>
                    <th scope="col">Category</th>
                    <th scope="col">Operations state</th>
                    <th scope="col">Customer decision</th>
                    <th scope="col">Supplier</th>
                    <th scope="col">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((request) => (
                    <tr key={request.id}>
                      <td><Link to={`/admin/tour-admin/requests/${request.id}`}>{request.requestReference}</Link></td>
                      <td>
                        {request.booking ? <Link to={`/admin/tour-admin/bookings/${encodeURIComponent(request.booking.bookingReference)}`}>{request.booking.bookingReference}</Link> : "-"}
                        <small className="d-block text-muted">{request.booking?.tour?.productTitle}</small>
                      </td>
                      <td>{requestTypeLabel(request.type)}</td>
                      <td>{categoryLabel(request.operations?.category)}</td>
                      <td><ToneBadge tone={requestStateTone(request.operations?.state)}>{requestStateLabel(request.operations?.state)}</ToneBadge></td>
                      <td>{statusWords(request.customerStatus)}</td>
                      <td>{statusWords(request.supplier?.syncStatus)}</td>
                      <td>{formatDateTime(request.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <TourAdminPagination page={data.page} limit={data.limit} total={data.total} onPage={goToPage} disabled={loading} label="requests" />
            </>
          ) : null}
        </Card.Body>
      </Card>
    </div>
  );
};

export default TourAdminRequestsPage;
