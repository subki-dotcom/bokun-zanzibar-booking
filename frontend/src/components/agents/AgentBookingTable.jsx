import Table from "react-bootstrap/Table";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import { Link } from "react-router-dom";
import { requestAgentBookingCancellation } from "../../api/agentApi";
import { formatCurrency, statusBadgeVariant } from "../../utils/formatters";

const paxLabel = (pax = {}) => {
  const rows = [
    pax.adults ? `Adults ${pax.adults}` : "",
    pax.children ? `Children ${pax.children}` : "",
    pax.infants ? `Infants ${pax.infants}` : ""
  ].filter(Boolean);

  return rows.length ? rows.join(", ") : "-";
};

const AgentBookingTable = ({ bookings = [], showActions = true, onBookingUpdated }) => {
  if (!bookings.length) {
    return <p className="text-muted mb-0">No bookings found.</p>;
  }

  const handleCancelRequest = async (booking) => {
    const reason = window.prompt("Reason for cancellation request?");
    if (!reason) {
      return;
    }

    const updated = await requestAgentBookingCancellation(booking._id, reason);
    onBookingUpdated?.(updated);
  };

  return (
    <Table responsive hover>
      <thead>
        <tr>
          <th>Reference</th>
          <th>Customer</th>
          <th>Tour</th>
          <th>Option</th>
          <th>Date</th>
          <th>Pax</th>
          <th>Status</th>
          <th>Payment</th>
          <th className="text-end">Total</th>
          {showActions ? <th className="text-end">Action</th> : null}
        </tr>
      </thead>
      <tbody>
        {bookings.map((booking) => (
          <tr key={booking.bookingReference}>
            <td>{booking.bookingReference}</td>
            <td>{`${booking.customer?.firstName || ""} ${booking.customer?.lastName || ""}`.trim() || "-"}</td>
            <td>{booking.productTitle}</td>
            <td>{booking.optionTitle || "-"}</td>
            <td>{booking.travelDate}</td>
            <td>{paxLabel(booking.paxSummary)}</td>
            <td>
              <Badge bg={statusBadgeVariant(booking.bookingStatus)}>{booking.bookingStatus}</Badge>
            </td>
            <td>
              <Badge bg={statusBadgeVariant(booking.paymentStatus)}>{booking.paymentStatus}</Badge>
            </td>
            <td className="text-end">
              {formatCurrency(booking.pricingSnapshot?.finalPayable || booking.pricingSnapshot?.grossAmount || 0, "USD")}
            </td>
            {showActions ? (
              <td className="text-end">
                <div className="agent-table-actions">
                  <Button as={Link} to={`/agent/bookings/${booking.bookingReference}`} size="sm" variant="outline-success">
                    View
                  </Button>
                  <Button as={Link} to={`/agent/bookings/${booking.bookingReference}/voucher`} size="sm" variant="outline-primary">
                    Voucher
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline-danger"
                    disabled={["cancelled", "completed", "failed"].includes(String(booking.bookingStatus || "").toLowerCase())}
                    onClick={() => handleCancelRequest(booking)}
                  >
                    Cancel
                  </Button>
                </div>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

export default AgentBookingTable;
