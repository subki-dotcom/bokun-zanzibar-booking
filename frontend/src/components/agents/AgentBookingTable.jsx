import Table from "react-bootstrap/Table";
import Badge from "react-bootstrap/Badge";
import { formatCurrency, statusBadgeVariant } from "../../utils/formatters";

const AgentBookingTable = ({ bookings = [] }) => {
  return (
    <Table responsive hover>
      <thead>
        <tr>
          <th>Reference</th>
          <th>Tour</th>
          <th>Date</th>
          <th>Status</th>
          <th>Payment</th>
          <th className="text-end">Total</th>
        </tr>
      </thead>
      <tbody>
        {bookings.map((booking) => (
          <tr key={booking.bookingReference}>
            <td>{booking.bookingReference}</td>
            <td>{booking.productTitle}</td>
            <td>{booking.travelDate}</td>
            <td>
              <Badge bg={statusBadgeVariant(booking.bookingStatus)}>{booking.bookingStatus}</Badge>
            </td>
            <td>
              <Badge bg={statusBadgeVariant(booking.paymentStatus)}>{booking.paymentStatus}</Badge>
            </td>
            <td className="text-end">
              {formatCurrency(booking.pricingSnapshot?.finalPayable || booking.pricingSnapshot?.grossAmount || 0, "USD")}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

export default AgentBookingTable;