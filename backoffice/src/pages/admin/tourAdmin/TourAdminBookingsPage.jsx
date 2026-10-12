import { useEffect, useRef, useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsSearch } from "react-icons/bs";
import { Link, useSearchParams } from "react-router-dom";
import PageHeader from "../../../components/admin/PageHeader";
import Loader from "../../../../../shared/src/components/common/Loader";
import { formatDate } from "../../../../../shared/src/utils/formatters";
import { fetchTourBookings } from "../../../api/tourOperationsApi";
import {
  BOOKING_STATUS_OPTIONS,
  PAYMENT_STATUS_OPTIONS,
  SUPPLIER_STATUS_OPTIONS,
  paymentLabel,
  statusWords,
  supplierLabel
} from "../../../config/tourOperations";
import {
  AttentionBadge,
  BokunSyncBadge,
  EmptyState,
  OriginBadge,
  PaymentBadge,
  SupplierBadge,
  TourAdminPagination,
  tourAdminErrorMessage
} from "../../../components/admin/tourAdmin/TourAdminUi";

const PAGE_SIZE = 25;
const FILTER_KEYS = ["search", "origin", "bookingStatus", "paymentStatus", "supplierStatus", "travelDateFrom", "travelDateTo"];
const emptyFilters = () => Object.fromEntries(FILTER_KEYS.map((key) => [key, ""]));

const readFilters = (searchParams) => Object.fromEntries(FILTER_KEYS.map((key) => [key, searchParams.get(key) || ""]));

const customerName = (customer = {}) => `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || "-";

const TourAdminBookingsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const applied = readFilters(searchParams);
  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
  const [draft, setDraft] = useState(applied);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const latest = useRef(0);
  const queryKey = searchParams.toString();

  useEffect(() => {
    setDraft(readFilters(searchParams));
    // Only the newest response is shown, so quick filter changes cannot display stale rows.
    const call = ++latest.current;
    setLoading(true);
    setError("");
    fetchTourBookings({ ...readFilters(searchParams), page, limit: PAGE_SIZE })
      .then((result) => { if (call === latest.current) setData(result); })
      .catch((err) => { if (call === latest.current) { setData(null); setError(tourAdminErrorMessage(err, "Tour bookings could not be loaded.")); } })
      .finally(() => { if (call === latest.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, reloadKey]);

  const applyFilters = (event) => {
    event.preventDefault();
    const search = draft.search.trim();
    if (search && search.length < 3) {
      setFormError("Search needs a full booking reference or email address.");
      return;
    }
    if (draft.travelDateFrom && draft.travelDateTo && draft.travelDateFrom > draft.travelDateTo) {
      setFormError("The travel date range ends before it starts.");
      return;
    }
    setFormError("");
    const next = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = key === "search" ? search : draft[key];
      if (value) next.set(key, value);
    }
    setSearchParams(next);
  };

  const resetFilters = () => {
    setDraft(emptyFilters());
    setFormError("");
    setSearchParams(new URLSearchParams());
  };

  const goToPage = (nextPage) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(nextPage));
    setSearchParams(next);
  };

  const reload = () => setReloadKey((value) => value + 1);
  const items = data?.items || [];

  const select = (id, label, key, options, format) => (
    <Col sm={6} lg={3}>
      <Form.Group controlId={id}>
        <Form.Label className="small">{label}</Form.Label>
        <Form.Select size="sm" value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}>
          <option value="">All</option>
          {options.map((option) => <option key={option} value={option}>{format(option)}</option>)}
        </Form.Select>
      </Form.Group>
    </Col>
  );

  return (
    <div className="tour-admin-bookings">
      <PageHeader
        eyebrow="Tour Admin"
        title="Tour Bookings"
        description="Website and Agent Portal tour bookings. Bookings imported from Bókun channels are handled in the Back Office."
        actions={<Button variant="outline-secondary" onClick={reload} disabled={loading}><BsArrowClockwise aria-hidden="true" /> Refresh</Button>}
      />

      <Card className="surface-card mt-3">
        <Card.Body>
          <Form onSubmit={applyFilters} className="tour-admin-filters" aria-label="Filter tour bookings">
            <Row className="g-2 align-items-end">
              <Col lg={6}>
                <Form.Group controlId="tour-bookings-search">
                  <Form.Label className="small">Booking reference or customer email</Form.Label>
                  <Form.Control size="sm" type="search" value={draft.search} maxLength={254} placeholder="ZNZ-… or guest@example.com" onChange={(event) => setDraft({ ...draft, search: event.target.value })} />
                </Form.Group>
              </Col>
              <Col sm={6} lg={3}>
                <Form.Group controlId="tour-bookings-from">
                  <Form.Label className="small">Travel from</Form.Label>
                  <Form.Control size="sm" type="date" value={draft.travelDateFrom} onChange={(event) => setDraft({ ...draft, travelDateFrom: event.target.value })} />
                </Form.Group>
              </Col>
              <Col sm={6} lg={3}>
                <Form.Group controlId="tour-bookings-to">
                  <Form.Label className="small">Travel to</Form.Label>
                  <Form.Control size="sm" type="date" value={draft.travelDateTo} onChange={(event) => setDraft({ ...draft, travelDateTo: event.target.value })} />
                </Form.Group>
              </Col>
              {select("tour-bookings-origin", "Origin", "origin", ["WEBSITE", "AGENT_PORTAL"], (value) => (value === "WEBSITE" ? "Website" : "Agent Portal"))}
              {select("tour-bookings-status", "Booking status", "bookingStatus", BOOKING_STATUS_OPTIONS, statusWords)}
              {select("tour-bookings-payment", "Payment", "paymentStatus", PAYMENT_STATUS_OPTIONS, paymentLabel)}
              {select("tour-bookings-supplier", "Supplier", "supplierStatus", SUPPLIER_STATUS_OPTIONS, supplierLabel)}
              <Col xs={12} className="d-flex gap-2 justify-content-end">
                <Button type="button" variant="outline-secondary" size="sm" onClick={resetFilters}>Reset</Button>
                <Button type="submit" size="sm" className="premium-btn text-white" disabled={loading}><BsSearch aria-hidden="true" /> Apply</Button>
              </Col>
            </Row>
            {formError ? <div className="text-danger small mt-2" role="alert">{formError}</div> : null}
          </Form>
        </Card.Body>
      </Card>

      <Card className="surface-card mt-3">
        <Card.Body>
          {error ? <div className="alert alert-danger" role="alert">{error}</div> : null}
          {loading ? <Loader message="Loading tour bookings..." /> : null}
          {!loading && !error && !items.length ? <EmptyState>No tour bookings match these filters.</EmptyState> : null}
          {!loading && items.length ? (
            <>
              <Table responsive hover className="align-middle tour-admin-bookings-table">
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Tour</th>
                    <th scope="col">Booked</th>
                    <th scope="col">Travel date</th>
                    <th scope="col">Origin</th>
                    <th scope="col">Payment</th>
                    <th scope="col">Bókun sync</th>
                    <th scope="col">Supplier</th>
                    <th scope="col">Attention</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((booking) => (
                    <tr key={booking.id}>
                      <td><Link to={`/admin/tour-admin/bookings/${encodeURIComponent(booking.bookingReference)}`}>{booking.bookingReference}</Link></td>
                      <td>{customerName(booking.customer)}</td>
                      <td>{booking.tour?.productTitle || "-"}<small className="d-block text-muted">{booking.tour?.optionTitle}</small></td>
                      <td>{formatDate(booking.createdAt)}</td>
                      <td>{booking.tour?.travelDate || "-"}{booking.tour?.startTime ? <small className="d-block text-muted">{booking.tour.startTime}</small> : null}</td>
                      <td><OriginBadge booking={booking} /></td>
                      <td><PaymentBadge status={booking.status?.payment} /></td>
                      <td><BokunSyncBadge supplierSync={booking.supplierSync} /></td>
                      <td><SupplierBadge status={booking.status?.supplier} /></td>
                      <td><AttentionBadge booking={booking} /></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <TourAdminPagination page={data.page} limit={data.limit} total={data.total} onPage={goToPage} disabled={loading} label="bookings" />
            </>
          ) : null}
        </Card.Body>
      </Card>
    </div>
  );
};

export default TourAdminBookingsPage;
