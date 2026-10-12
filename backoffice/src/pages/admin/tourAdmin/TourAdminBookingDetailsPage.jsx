import { useCallback, useEffect, useState } from "react";
import { Button, Card, Col, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsArrowLeft } from "react-icons/bs";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../../../components/admin/PageHeader";
import Loader from "../../../../../shared/src/components/common/Loader";
import useAuth from "../../../../../shared/src/hooks/useAuth";
import { formatDate } from "../../../../../shared/src/utils/formatters";
import { formatDateTime } from "../../../components/admin/AdminDataWidgets";
import { fetchTourBooking, fetchTourRequests } from "../../../api/tourOperationsApi";
import {
  TOUR_PERMISSIONS,
  categoryLabel,
  hasPermission,
  requestStateLabel,
  requestStateTone,
  requestTypeLabel,
  statusWords
} from "../../../config/tourOperations";
import {
  AttentionBadge,
  BokunSyncBadge,
  EmptyState,
  OriginBadge,
  PaymentBadge,
  SupplierBadge,
  ToneBadge,
  tourAdminErrorMessage
} from "../../../components/admin/tourAdmin/TourAdminUi";

const Field = ({ label, children }) => (
  <div className="mb-3">
    <small className="text-muted d-block">{label}</small>
    <div>{children || "-"}</div>
  </div>
);

// Read-only operational view. Supplier-confirmed details cannot be edited here; changes go through
// customer requests and the Back Office.
const TourAdminBookingDetailsPage = () => {
  const { bookingReference } = useParams();
  const { user } = useAuth();
  const canReadRequests = hasPermission(user, TOUR_PERMISSIONS.REQUESTS_READ);
  const [booking, setBooking] = useState(null);
  const [requests, setRequests] = useState([]);
  const [requestsError, setRequestsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setRequestsError("");
    try {
      const found = await fetchTourBooking(bookingReference);
      setBooking(found);
      if (!found) {
        setError("Not found, or not part of Tour Operations.");
        return;
      }
      if (canReadRequests) {
        try {
          const result = await fetchTourRequests({ bookingReference: found.bookingReference, limit: 100 });
          setRequests(result?.items || []);
        } catch (err) {
          setRequests([]);
          setRequestsError(tourAdminErrorMessage(err, "Customer requests could not be loaded."));
        }
      }
    } catch (err) {
      setBooking(null);
      setError(tourAdminErrorMessage(err, "This booking could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [bookingReference, canReadRequests]);

  useEffect(() => { load(); }, [load]);

  const back = <Button as={Link} to="/admin/tour-admin/bookings" variant="outline-secondary"><BsArrowLeft aria-hidden="true" /> All bookings</Button>;

  if (loading) return <Loader message="Loading booking..." />;
  if (!booking) {
    return (
      <div className="tour-admin-booking-details">
        <PageHeader eyebrow="Tour Admin" title={bookingReference} actions={back} />
        <div className="alert alert-danger mt-3" role="alert">{error}</div>
      </div>
    );
  }

  const paidButNotConfirmed = booking.status?.payment === "paid" && booking.status?.supplier !== "confirmed";

  return (
    <div className="tour-admin-booking-details">
      <PageHeader
        eyebrow="Tour Admin · Booking"
        title={booking.bookingReference}
        description={`${booking.tour?.productTitle || ""}${booking.tour?.optionTitle ? ` · ${booking.tour.optionTitle}` : ""}`}
        actions={<div className="d-flex gap-2">{back}<Button variant="outline-secondary" onClick={load}><BsArrowClockwise aria-hidden="true" /> Refresh</Button></div>}
      />

      <Row className="g-3 mt-1">
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h3 className="h6">Summary</h3>
              <Field label="Attention"><AttentionBadge booking={booking} /></Field>
              <Field label="Origin"><OriginBadge booking={booking} /></Field>
              <Field label="Booking status">{statusWords(booking.status?.booking)}</Field>
              <Field label="Booked on">{formatDateTime(booking.createdAt)}</Field>
              {booking.status?.cancelledAt ? <Field label="Cancelled on">{formatDateTime(booking.status.cancelledAt)}</Field> : null}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h3 className="h6">Tour</h3>
              <Field label="Product">{booking.tour?.productTitle}</Field>
              <Field label="Option">{booking.tour?.optionTitle}</Field>
              <Field label="Travel date">{booking.tour?.travelDate ? `${formatDate(booking.tour.travelDate)}${booking.tour.startTime ? ` at ${booking.tour.startTime}` : ""}` : "-"}</Field>
              <Field label="Travellers">{`${booking.tour?.pax?.total || 0} (${booking.tour?.pax?.adults || 0} adults, ${booking.tour?.pax?.children || 0} children, ${booking.tour?.pax?.infants || 0} infants)`}</Field>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h3 className="h6">Customer contact</h3>
              <Field label="Name">{`${booking.customer?.firstName || ""} ${booking.customer?.lastName || ""}`.trim()}</Field>
              <Field label="Email">{booking.customer?.email ? <a href={`mailto:${booking.customer.email}`}>{booking.customer.email}</a> : null}</Field>
              <Field label="Phone">{booking.customer?.phone ? <a href={`tel:${booking.customer.phone}`}>{booking.customer.phone}</a> : null}</Field>
              <Field label="Country">{booking.customer?.country}</Field>
              <Field label="Hotel / pickup">{booking.customer?.hotelName}</Field>
              {booking.agentId ? <Field label="Agent Portal booking">Agent account {booking.agentId}</Field> : null}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h3 className="h6">Payment and supplier</h3>
              <Field label="Payment"><PaymentBadge status={booking.status?.payment} /></Field>
              <Field label="Supplier confirmation"><SupplierBadge status={booking.status?.supplier} /></Field>
              <Field label="Bókun synchronization"><BokunSyncBadge supplierSync={booking.supplierSync} /></Field>
              {booking.supplierSync?.confirmationCode ? <Field label="Supplier confirmation code">{booking.supplierSync.confirmationCode}</Field> : null}
              {booking.supplierSync?.finalizationStatus ? <Field label="Supplier sync step">{statusWords(booking.supplierSync.finalizationStatus)}</Field> : null}
              {booking.status?.supplierUpdatedAt ? <Field label="Supplier status updated">{formatDateTime(booking.status.supplierUpdatedAt)}</Field> : null}
              {paidButNotConfirmed ? (
                <div className="alert alert-warning small mb-0" role="note">
                  Payment is verified, but the supplier has not confirmed this booking yet. Do not treat it as confirmed.
                </div>
              ) : null}
              <small className="text-muted d-block mt-2">Amounts, transactions and invoices are handled by Finance.</small>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Card className="surface-card mt-3">
        <Card.Body>
          <h3 className="h6">Customer requests</h3>
          {!canReadRequests ? <p className="text-muted mb-0">Your account cannot view customer requests.</p> : null}
          {requestsError ? <div className="alert alert-danger" role="alert">{requestsError}</div> : null}
          {canReadRequests && !requestsError && !requests.length ? <EmptyState>No customer requests for this booking.</EmptyState> : null}
          {requests.length ? (
            <Table responsive hover className="align-middle mb-0">
              <thead>
                <tr><th scope="col">Request</th><th scope="col">Type</th><th scope="col">Category</th><th scope="col">Operations</th><th scope="col">Received</th></tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td><Link to={`/admin/tour-admin/requests/${request.id}`}>{request.requestReference}</Link></td>
                    <td>{requestTypeLabel(request.type)}</td>
                    <td>{categoryLabel(request.operations?.category)}</td>
                    <td><ToneBadge tone={requestStateTone(request.operations?.state)}>{requestStateLabel(request.operations?.state)}</ToneBadge></td>
                    <td>{formatDateTime(request.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </Card.Body>
      </Card>

      <Card className="surface-card mt-3">
        <Card.Body>
          <h3 className="h6">Booking history</h3>
          <p className="text-muted mb-0">A booking history is not available in Tour Operations yet. Request history is shown on each request.</p>
        </Card.Body>
      </Card>
    </div>
  );
};

export default TourAdminBookingDetailsPage;
