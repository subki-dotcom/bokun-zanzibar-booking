import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { fetchBookings } from "../api/transferAdminApi";
import { Empty, ErrorMessage, Loading, PageHeader, Pager, StatusBadge, useResource } from "../components/ui";
import { ARRANGEMENT, PAYMENT, STATUS, legWhen, passengers, usd } from "../lib/format";

const FILTERS = ["status", "paymentStatus", "source", "from", "to", "search", "sort", "page"];

const BookingsPage = () => {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => Object.fromEntries(FILTERS.filter((key) => params.get(key)).map((key) => [key, params.get(key)])), [params]);
  const { data, loading, error, reload } = useResource(() => fetchBookings({ ...query, limit: 25 }), [JSON.stringify(query)]);

  const set = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  };

  return (
    <>
      <PageHeader
        title="Bookings"
        subtitle="Bookings made by customers on the website. Staff-entered bookings are older records only."
      />
      <Card className="ta-card mb-3">
        <Card.Body>
          <Row className="g-2">
            <Col xs={12} md={4}>
              <Form.Control key={query.search || ""} type="search" placeholder="Reference, name, email, phone, flight" defaultValue={query.search || ""} aria-label="Search bookings"
                onKeyDown={(event) => event.key === "Enter" && set("search", event.currentTarget.value.trim())} onBlur={(event) => set("search", event.currentTarget.value.trim())} />
            </Col>
            <Col xs={6} md={2}>
              <Form.Select aria-label="Status" value={query.status || ""} onChange={(event) => set("status", event.target.value)}>
                <option value="">All statuses</option>
                {Object.entries(STATUS).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
              </Form.Select>
            </Col>
            <Col xs={6} md={2}>
              <Form.Select aria-label="Source" value={query.source || ""} onChange={(event) => set("source", event.target.value)}>
                <option value="">All sources</option>
                <option value="WEBSITE">Website</option>
                <option value="MANUAL">Staff-entered (legacy)</option>
              </Form.Select>
            </Col>
            <Col xs={6} md={2}>
              <Form.Control type="date" aria-label="Pickup from" value={query.from || ""} onChange={(event) => set("from", event.target.value)} />
            </Col>
            <Col xs={6} md={2}>
              <Form.Control type="date" aria-label="Pickup to" value={query.to || ""} onChange={(event) => set("to", event.target.value)} />
            </Col>
            <Col xs={12} className="d-flex flex-wrap gap-2 align-items-center">
              <Form.Select size="sm" className="w-auto" aria-label="Sort" value={query.sort || ""} onChange={(event) => set("sort", event.target.value)}>
                <option value="">Newest first</option>
                <option value="pickup">Pickup date</option>
              </Form.Select>
              {Object.keys(query).length ? <Button size="sm" variant="link" onClick={() => setParams(new URLSearchParams())}>Clear filters</Button> : null}
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <ErrorMessage error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : null}
      {data ? (
        data.items.length ? (
          <Card className="ta-card">
            <Table responsive hover className="mb-0 align-middle ta-table">
              <thead>
                <tr><th>Reference</th><th>Pickup (EAT)</th><th>Route</th><th>Pax</th><th>Customer</th><th className="text-end">Total</th><th>Status</th><th>Payment</th></tr>
              </thead>
              <tbody>
                {data.items.map((booking) => (
                  <tr key={booking.id}>
                    <td>
                      <Link to={`/bookings/${booking.id}`}>{booking.reference}</Link>
                      <div className="small text-muted">{booking.source === "MANUAL" ? `Staff (legacy) · ${booking.manualChannel}` : "Website"}{booking.tripType === "ROUND_TRIP" ? " · Round trip" : ""}</div>
                    </td>
                    <td>{legWhen(booking.firstLeg)}</td>
                    <td>{booking.firstLeg?.pickupLocationName} → {booking.firstLeg?.dropoffLocationName}</td>
                    <td>{passengers(booking.passengers)}</td>
                    <td>{booking.customer.fullName}<div className="small text-muted">{booking.customer.phone}</div></td>
                    <td className="text-end">{booking.pricing.status === "PRICED" ? usd(booking.pricing.total) : "Quote"}</td>
                    <td><StatusBadge status={booking.status} /></td>
                    <td>{PAYMENT[booking.paymentStatus]}{booking.paymentArrangement === "CASH_ON_ARRIVAL" ? <div className="small text-muted">{ARRANGEMENT.CASH_ON_ARRIVAL}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Card.Footer><Pager pagination={data.pagination} onPage={(page) => set("page", String(page))} /></Card.Footer>
          </Card>
        ) : (
          <Empty>No bookings match these filters.</Empty>
        )
      ) : null}
    </>
  );
};

export default BookingsPage;
