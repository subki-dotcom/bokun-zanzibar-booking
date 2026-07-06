import { useEffect, useState } from "react";
import { Card, Col, Form, Row } from "react-bootstrap";
import { fetchAgentBookings } from "../../api/agentApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import AgentBookingTable from "../../components/agents/AgentBookingTable";

const AgentBookingsPage = () => {
  const [bookings, setBookings] = useState([]);
  const [filters, setFilters] = useState({ search: "", bookingStatus: "", paymentStatus: "", travelDate: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchAgentBookings();
        setBookings(data);
      } catch (err) {
        setError(err.message || "Failed to load agent bookings");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  return (
    <>
      <h2 className="mb-1">My Bookings</h2>
      <p className="section-subtitle mb-4">All bookings created from your agent portal.</p>

      <ErrorAlert error={error} />
      <Card className="surface-card mb-4">
        <Card.Body>
          <Row className="g-3">
            <Col md={4}><Form.Control placeholder="Search customer or reference" value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))} /></Col>
            <Col md={3}><Form.Control type="date" value={filters.travelDate} onChange={(e) => setFilters((prev) => ({ ...prev, travelDate: e.target.value }))} /></Col>
            <Col md={3}><Form.Select value={filters.bookingStatus} onChange={(e) => setFilters((prev) => ({ ...prev, bookingStatus: e.target.value }))}><option value="">All booking statuses</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option><option value="completed">Completed</option><option value="failed">Failed</option></Form.Select></Col>
            <Col md={2}><Form.Select value={filters.paymentStatus} onChange={(e) => setFilters((prev) => ({ ...prev, paymentStatus: e.target.value }))}><option value="">All payments</option><option value="pending">Unpaid</option><option value="deposit_paid">Deposit Paid</option><option value="paid">Paid</option><option value="refunded">Refunded</option><option value="failed">Failed</option></Form.Select></Col>
          </Row>
        </Card.Body>
      </Card>
      {loading ? <Loader message="Loading bookings..." /> : null}

      {!loading ? (
        <Card className="surface-card">
          <Card.Body>
            <AgentBookingTable
              bookings={bookings.filter((booking) => {
                const token = filters.search.trim().toLowerCase();
                const matchesSearch = !token || [
                  booking.bookingReference,
                  booking.productTitle,
                  booking.optionTitle,
                  booking.customer?.firstName,
                  booking.customer?.lastName,
                  booking.customer?.email
                ].join(" ").toLowerCase().includes(token);
                const matchesDate = !filters.travelDate || booking.travelDate === filters.travelDate;
                const matchesBooking = !filters.bookingStatus || booking.bookingStatus === filters.bookingStatus;
                const matchesPayment = !filters.paymentStatus || booking.paymentStatus === filters.paymentStatus;
                return matchesSearch && matchesDate && matchesBooking && matchesPayment;
              })}
              onBookingUpdated={(updated) => {
                setBookings((prev) =>
                  prev.map((booking) => booking._id === updated._id ? updated : booking)
                );
              }}
            />
          </Card.Body>
        </Card>
      ) : null}
    </>
  );
};

export default AgentBookingsPage;
