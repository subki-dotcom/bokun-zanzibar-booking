import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Col, Form, Row } from "react-bootstrap";
import { Link } from "react-router-dom";
import { BsCalendar3, BsDownload, BsEye, BsSearch, BsShieldCheck, BsTicketPerforated } from "react-icons/bs";
import { fetchAgentBookings } from "../../api/agentApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import { statusBadgeVariant } from "../../utils/formatters";

const VoucherStat = ({ label, value, icon }) => (
  <Card className="agent-voucher-stat">
    <Card.Body>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </Card.Body>
  </Card>
);

const customerNameFor = (booking = {}) =>
  `${booking.customer?.firstName || ""} ${booking.customer?.lastName || ""}`.trim() || "-";

const AgentVouchersPage = () => {
  const [bookings, setBookings] = useState([]);
  const [filters, setFilters] = useState({ search: "", status: "", travelDate: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setError("");
        setBookings(await fetchAgentBookings());
      } catch (err) {
        setError(err.message || "Failed to load vouchers");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const filteredBookings = useMemo(() => {
    const token = filters.search.trim().toLowerCase();
    return bookings.filter((booking) => {
      const matchesSearch = !token || [
        booking.bookingReference,
        booking.productTitle,
        booking.optionTitle,
        customerNameFor(booking),
        booking.customer?.email
      ].join(" ").toLowerCase().includes(token);
      const matchesStatus = !filters.status || booking.bookingStatus === filters.status;
      const matchesDate = !filters.travelDate || booking.travelDate === filters.travelDate;
      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [bookings, filters]);

  const confirmedCount = bookings.filter((booking) => booking.bookingStatus === "confirmed").length;
  const paidCount = bookings.filter((booking) => booking.paymentStatus === "paid").length;

  return (
    <div className="agent-vouchers-page">
      <div className="agent-vouchers-hero">
        <div>
          <span className="voucher-kicker">Agent Vouchers</span>
          <h2>Customer Vouchers</h2>
          <p>Download, print, and review customer travel vouchers for your bookings.</p>
        </div>
        <Button as={Link} to="/agent/new-booking" className="agent-primary-btn">
          New Booking
        </Button>
      </div>

      <ErrorAlert error={error} />

      <div className="agent-voucher-stat-grid">
        <VoucherStat label="Total Vouchers" value={bookings.length} icon={<BsTicketPerforated />} />
        <VoucherStat label="Confirmed Bookings" value={confirmedCount} icon={<BsShieldCheck />} />
        <VoucherStat label="Paid Vouchers" value={paidCount} icon={<BsDownload />} />
        <VoucherStat label="Filtered Results" value={filteredBookings.length} icon={<BsSearch />} />
      </div>

      <Card className="surface-card mb-4">
        <Card.Body>
          <Row className="g-3 align-items-center">
            <Col lg={6}>
              <div className="agent-voucher-search">
                <BsSearch />
                <Form.Control
                  placeholder="Search voucher, customer, tour, or email"
                  value={filters.search}
                  onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                />
              </div>
            </Col>
            <Col md={3}>
              <Form.Control
                type="date"
                value={filters.travelDate}
                onChange={(event) => setFilters((prev) => ({ ...prev, travelDate: event.target.value }))}
              />
            </Col>
            <Col md={3}>
              <Form.Select
                value={filters.status}
                onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
              >
                <option value="">All voucher statuses</option>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="cancelled">Cancelled</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </Form.Select>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {loading ? <Loader message="Loading vouchers..." /> : null}

      {!loading ? (
        <div className="agent-voucher-list">
          {filteredBookings.map((booking) => (
            <Card className="agent-voucher-list-card" key={booking.bookingReference}>
              <Card.Body>
                <div className="agent-voucher-ticket-mark">
                  <BsTicketPerforated />
                </div>
                <div className="agent-voucher-list-main">
                  <div className="agent-voucher-list-title">
                    <div>
                      <strong>{booking.bookingReference}</strong>
                      <span>{customerNameFor(booking)}</span>
                    </div>
                    <Badge bg={statusBadgeVariant(booking.bookingStatus)}>{booking.bookingStatus}</Badge>
                  </div>
                  <div className="agent-voucher-list-meta">
                    <span>{booking.productTitle || "-"}</span>
                    <span>{booking.optionTitle || "-"}</span>
                    <span><BsCalendar3 /> {booking.travelDate || "-"}</span>
                    <span>Payment: {booking.paymentStatus || "-"}</span>
                  </div>
                </div>
                <div className="agent-voucher-list-actions">
                  <Button as={Link} to={`/agent/bookings/${booking.bookingReference}`} variant="outline-secondary" size="sm">
                    <BsEye className="me-1" /> View
                  </Button>
                  <Button as={Link} to={`/agent/bookings/${booking.bookingReference}/voucher`} variant="outline-success" size="sm">
                    <BsDownload className="me-1" /> Voucher
                  </Button>
                </div>
              </Card.Body>
            </Card>
          ))}

          {!filteredBookings.length ? (
            <Card className="surface-card">
              <Card.Body className="text-center text-muted py-4">No vouchers match your filters.</Card.Body>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default AgentVouchersPage;
