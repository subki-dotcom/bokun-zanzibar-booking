import { Badge, Modal, Table } from "react-bootstrap";
import { Link } from "react-router-dom";
import { Empty, ErrorMessage, Loading, useResource } from "../components/ui";
import { TripStatusBadge } from "../components/trips";
import { dateTime } from "../lib/format";

// Every trip a driver or vehicle was ever assigned to, including ones later reassigned to someone else.
const FleetHistoryModal = ({ title, load, show, onHide }) => {
  const { data, loading, error } = useResource(() => (show ? load() : Promise.resolve(null)), [show]);
  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton><Modal.Title as="h2" className="h5">{title}</Modal.Title></Modal.Header>
      <Modal.Body>
        <ErrorMessage error={error} />
        {loading && !data ? <Loading /> : null}
        {data && !data.length ? <Empty>No assignments yet.</Empty> : null}
        {data?.length ? (
          <Table responsive size="sm" className="mb-0">
            <thead><tr><th>Pickup (EAT)</th><th>Booking</th><th>Trip</th><th>History</th></tr></thead>
            <tbody>
              {data.map((item) => (
                <tr key={item.tripId}>
                  <td className="text-nowrap">{dateTime(item.pickupAt)}</td>
                  <td><Link to={`/bookings/${item.bookingId}`} onClick={onHide}>{item.bookingReference}</Link> <span className="small text-muted">{item.direction === "RETURN" ? "return" : "outbound"}</span></td>
                  <td><TripStatusBadge status={item.status} />{item.current ? <Badge bg="light" text="dark" className="ms-1">current</Badge> : null}</td>
                  <td className="small">{item.history.map((entry, index) => <div key={index}>{entry.action.toLowerCase()} · {dateTime(entry.at)} · {entry.by}{entry.reason ? ` · ${entry.reason}` : ""}</div>)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}
      </Modal.Body>
    </Modal>
  );
};

export default FleetHistoryModal;
