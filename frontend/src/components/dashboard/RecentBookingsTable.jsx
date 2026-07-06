import Table from "react-bootstrap/Table";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import { formatCurrency, statusBadgeVariant } from "../../utils/formatters";

const RecentBookingsTable = ({ bookings = [], onCancel = null }) => {
  return (
    <Table responsive hover>
      <thead>
        <tr>
          <th>Reference</th>
          <th>Product</th>
          <th>Date</th>
          <th>Status</th>
          <th>Payment</th>
          <th className="text-end">Total</th>
          {onCancel ? <th className="text-end">Actions</th> : null}
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
            {onCancel ? (
              <td className="text-end">
                <Button
                  size="sm"
                  variant="outline-danger"
                  disabled={booking.bookingStatus === "cancelled"}
                  onClick={() => onCancel(booking)}
                >
                  Cancel
                </Button>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

export default RecentBookingsTable;
