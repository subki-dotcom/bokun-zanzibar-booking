import { useEffect, useState } from "react";
import { Badge, Button, Card, Table } from "react-bootstrap";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import {
  BsBriefcase,
  BsCalendar3,
  BsCashCoin,
  BsCheckCircleFill,
  BsClipboardCheck,
  BsEye,
  BsHourglassSplit,
  BsWallet2,
  BsXCircle
} from "react-icons/bs";
import { fetchAgentDashboard, fetchAgentStatement } from "../../api/agentApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import { formatCurrency, statusBadgeVariant } from "../../utils/formatters";

const metricIcons = {
  bookings: <BsBriefcase />,
  pending: <BsHourglassSplit />,
  confirmed: <BsCheckCircleFill />,
  cancelled: <BsXCircle />,
  sales: <BsWallet2 />,
  commission: <BsWallet2 />,
  unpaid: <BsCashCoin />,
  total: <BsClipboardCheck />
};

const MetricCard = ({ label, value, delta, tone = "blue", icon }) => (
  <Card className={`agent-stat-card tone-${tone}`}>
    <Card.Body>
      <div className="agent-stat-icon">{icon}</div>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{delta}</span>
      </div>
    </Card.Body>
  </Card>
);

const ChartPanel = () => {
  const bookingPoints = "10,145 80,126 150,151 220,112 290,78 360,96 430,70 500,55 570,78 640,70 710,35";
  const salesPoints = "10,160 80,112 150,135 220,82 290,45 360,82 430,58 500,22 570,66 640,48 710,12";

  return (
    <Card className="agent-chart-card">
      <Card.Body>
        <div className="agent-card-head">
          <h5>Bookings Overview</h5>
          <select aria-label="Chart range">
            <option>This Month</option>
          </select>
        </div>
        <div className="agent-chart-legend">
          <span className="is-blue">Bookings</span>
          <span className="is-green">Sales (USD)</span>
        </div>
        <svg className="agent-overview-chart" viewBox="0 0 740 190" role="img" aria-label="Bookings overview chart">
          {[0, 1, 2, 3, 4].map((row) => (
            <line key={row} x1="0" x2="740" y1={20 + row * 35} y2={20 + row * 35} />
          ))}
          <polyline points={bookingPoints} className="chart-bookings-fill" />
          <polyline points={bookingPoints} className="chart-bookings-line" />
          <polyline points={salesPoints} className="chart-sales-line" />
          {bookingPoints.split(" ").map((point) => {
            const [cx, cy] = point.split(",");
            return <circle key={`b-${point}`} cx={cx} cy={cy} r="4" className="chart-bookings-dot" />;
          })}
          {salesPoints.split(" ").map((point) => {
            const [cx, cy] = point.split(",");
            return <circle key={`s-${point}`} cx={cx} cy={cy} r="4" className="chart-sales-dot" />;
          })}
        </svg>
        <div className="agent-chart-days">
          <span>01 Jun</span><span>03 Jun</span><span>05 Jun</span><span>07 Jun</span><span>09 Jun</span><span>10 Jun</span>
        </div>
      </Card.Body>
    </Card>
  );
};

const RecentBookings = ({ bookings = [] }) => (
  <Card className="agent-recent-card">
    <Card.Body>
      <div className="agent-card-head">
        <h5>Recent Bookings</h5>
        <Button as={Link} to="/agent/bookings" variant="outline-secondary" size="sm">View All</Button>
      </div>
      <Table responsive className="agent-recent-table">
        <thead>
          <tr>
            <th className="col-ref">Booking Ref</th>
            <th className="col-customer">Customer</th>
            <th className="col-tour">Tour</th>
            <th className="col-date">Date</th>
            <th className="col-pax">Pax</th>
            <th className="col-total">Total</th>
            <th className="col-status">Status</th>
            <th className="col-action">Action</th>
          </tr>
        </thead>
        <tbody>
          {bookings.slice(0, 5).map((booking) => {
            const customer = `${booking.customer?.firstName || ""} ${booking.customer?.lastName || ""}`.trim() || "-";
            const pax = Number(booking.paxSummary?.total || booking.paxSummary?.adults || 0) || "-";
            return (
              <tr key={booking.bookingReference}>
                <td className="agent-ref col-ref">{booking.bookingReference}</td>
                <td className="col-customer"><span className="agent-table-truncate">{customer}</span></td>
                <td className="col-tour">
                  <strong className="agent-table-truncate">{booking.productTitle}</strong>
                  <small className="agent-table-truncate">{booking.optionTitle}</small>
                </td>
                <td className="col-date">{booking.travelDate ? dayjs(booking.travelDate).format("DD MMM YYYY") : "-"}</td>
                <td className="col-pax">{pax}</td>
                <td className="col-total">{formatCurrency(booking.pricingSnapshot?.finalPayable || booking.amount || 0, booking.currency || "USD")}</td>
                <td className="col-status"><Badge bg={statusBadgeVariant(booking.bookingStatus)}>{booking.bookingStatus}</Badge></td>
                <td className="col-action">
                  <Button as={Link} to={`/agent/bookings/${booking.bookingReference}`} variant="outline-primary" size="sm" className="agent-view-btn">
                    <BsEye />
                  </Button>
                </td>
              </tr>
            );
          })}
          {!bookings.length ? (
            <tr><td colSpan="8" className="text-center text-muted py-4">No recent bookings yet.</td></tr>
          ) : null}
        </tbody>
      </Table>
    </Card.Body>
  </Card>
);

const AgentDashboardPage = () => {
  const [dashboard, setDashboard] = useState(null);
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const month = dayjs().format("YYYY-MM");
        const [dashboardResult, statementResult] = await Promise.all([
          fetchAgentDashboard(),
          fetchAgentStatement(month)
        ]);

        setDashboard(dashboardResult);
        setStatement(statementResult);
      } catch (err) {
        setError(err.message || "Failed to load agent dashboard");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  if (loading) {
    return <Loader message="Loading agent dashboard..." />;
  }

  return (
    <div className="agent-dashboard-page">
      <div className="agent-dashboard-welcome">
        <div>
          <h2>Welcome back, {dashboard?.agentName || "Riser Agent"}!</h2>
          <p>Here's what's happening with your business today.</p>
        </div>
        <div className="agent-date-pill"><BsCalendar3 /> {dayjs().format("dddd, DD MMMM YYYY")}</div>
      </div>
      <ErrorAlert error={error} />

      <div className="agent-stat-grid">
        <MetricCard label="Today Bookings" value={dashboard?.summary?.todayBookings || 0} delta="+33% from yesterday" tone="blue" icon={metricIcons.bookings} />
        <MetricCard label="Pending Bookings" value={dashboard?.summary?.pendingBookings || 0} delta="+25% from yesterday" tone="amber" icon={metricIcons.pending} />
        <MetricCard label="Confirmed Bookings" value={dashboard?.summary?.confirmedBookings || 0} delta="+20% from yesterday" tone="green" icon={metricIcons.confirmed} />
        <MetricCard label="Cancelled Bookings" value={dashboard?.summary?.cancelledBookings || 0} delta="-50% from yesterday" tone="red" icon={metricIcons.cancelled} />
        <MetricCard label="Total Sales (This Month)" value={formatCurrency(dashboard?.summary?.totalSales || 0, "USD")} delta="+18% from last month" tone="purple" icon={metricIcons.sales} />
        <MetricCard label="Total Commission" value={formatCurrency(dashboard?.summary?.totalCommission || 0, "USD")} delta="+18% from last month" tone="blue" icon={metricIcons.commission} />
        <MetricCard label="Unpaid Commission" value={formatCurrency(dashboard?.summary?.unpaidCommission || 0, "USD")} delta="Pending payout" tone="orange" icon={metricIcons.unpaid} />
        <MetricCard label="Total Bookings (This Month)" value={(dashboard?.bookings || []).length} delta="+15% from last month" tone="teal" icon={metricIcons.total} />
      </div>

      <div className="agent-dashboard-grid">
        <div>
          <ChartPanel />
          <Card className="agent-growth-card">
            <Card.Body>
              <h5>Let's grow your business!</h5>
              <p>Book more tours and earn more commissions.</p>
              <Button as={Link} to="/agent/new-booking" className="agent-primary-btn">+ New Booking</Button>
            </Card.Body>
          </Card>
        </div>
        <RecentBookings bookings={dashboard?.bookings || []} />
      </div>

      <span className="d-none">{statement?.payoutMonth}</span>
    </div>
  );
};

export default AgentDashboardPage;
