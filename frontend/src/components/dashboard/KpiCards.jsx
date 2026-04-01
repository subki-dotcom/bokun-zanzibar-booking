import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import StatCard from "../common/StatCard";
import { formatCurrency } from "../../utils/formatters";

const KpiCards = ({ kpis = {} }) => {
  return (
    <Row className="g-3">
      <Col md={3} sm={6}>
        <StatCard title="Total Bookings" value={kpis.totalBookings || 0} />
      </Col>
      <Col md={3} sm={6}>
        <StatCard title="Confirmed" value={kpis.confirmedBookings || 0} />
      </Col>
      <Col md={3} sm={6}>
        <StatCard title="Cancelled" value={kpis.cancelledBookings || 0} />
      </Col>
      <Col md={3} sm={6}>
        <StatCard title="Total Sales" value={formatCurrency(kpis.totalSales || 0, "USD")} />
      </Col>
    </Row>
  );
};

export default KpiCards;