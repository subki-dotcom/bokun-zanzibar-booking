import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsBarChartLine, BsBoxes, BsGraphUpArrow, BsPeople } from "react-icons/bs";
import {
  fetchChannelAnalytics,
  fetchExecutiveAnalytics,
  fetchProductAnalytics,
  fetchSalesAnalytics,
  fetchTrendAnalytics
} from "../../api/adminApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import { formatCurrency } from "../../utils/formatters";

const PERIOD_OPTIONS = [
  { value: "TODAY", label: "Today" },
  { value: "THIS_WEEK", label: "This week" },
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "THIS_QUARTER", label: "This quarter" },
  { value: "THIS_YEAR", label: "This year" },
  { value: "LIFETIME", label: "Lifetime" }
];

const safeNumber = (value = 0) => Number(value || 0);

const formatPercent = (value) => (value === null || value === undefined ? "-" : `${Number(value || 0).toFixed(1)}%`);

const comparisonText = (comparison) => {
  if (!comparison) return "";
  if (!comparison.comparisonValid) return comparison.reason === "ZERO_PREVIOUS_VALUE" ? "No previous baseline" : "";
  const sign = Number(comparison.percentageChange || 0) >= 0 ? "+" : "";
  return `${sign}${comparison.percentageChange}% vs previous`;
};

const MetricCard = ({ label, value, detail = "", icon: Icon = BsBarChartLine }) => (
  <Card className="surface-card h-100">
    <Card.Body>
      <div className="d-flex justify-content-between align-items-start gap-3">
        <div>
          <small className="text-muted d-block">{label}</small>
          <strong className="fs-4 d-block">{value}</strong>
          {detail ? <span className="text-muted small">{detail}</span> : null}
        </div>
        <span className="admin-platform-brand-mark d-inline-flex align-items-center justify-content-center">
          <Icon aria-hidden="true" />
        </span>
      </div>
    </Card.Body>
  </Card>
);

const DataWarnings = ({ warnings = [] }) => {
  if (!warnings.length) return null;

  return (
    <Card className="surface-card border-warning-subtle">
      <Card.Body>
        <h5 className="mb-3">Data Quality</h5>
        <div className="d-grid gap-2">
          {warnings.slice(0, 6).map((warning) => (
            <div key={warning.code} className="d-flex justify-content-between gap-3 border rounded-3 p-2">
              <div>
                <strong>{warning.code.replaceAll("_", " ")}</strong>
                <small className="text-muted d-block">{warning.message}</small>
              </div>
              <Badge bg={warning.severity === "warning" ? "warning" : "secondary"} text={warning.severity === "warning" ? "dark" : undefined}>
                {warning.count}
              </Badge>
            </div>
          ))}
        </div>
      </Card.Body>
    </Card>
  );
};

const AdminBusinessIntelligencePage = () => {
  const [period, setPeriod] = useState("THIS_MONTH");
  const [data, setData] = useState({
    executive: null,
    sales: null,
    products: null,
    channels: null,
    trends: null
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const query = {
        period,
        compare: "PREVIOUS_PERIOD"
      };
      const [executive, sales, products, channels, trends] = await Promise.all([
        fetchExecutiveAnalytics(query),
        fetchSalesAnalytics({ ...query, granularity: "MONTH" }),
        fetchProductAnalytics(query),
        fetchChannelAnalytics(query),
        fetchTrendAnalytics({ ...query, granularity: "MONTH" })
      ]);

      setData({ executive, sales, products, channels, trends });
    } catch (err) {
      setError(err.message || "Failed to load Business Intelligence");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const warnings = useMemo(() => {
    const rows = [
      ...(data.executive?.dataQuality?.warnings || []),
      ...(data.products?.dataQuality?.warnings || []),
      ...(data.channels?.dataQuality?.warnings || []),
      ...(data.trends?.dataQuality?.warnings || [])
    ];
    const byCode = new Map();
    rows.forEach((warning) => {
      const existing = byCode.get(warning.code);
      if (existing) {
        existing.count += Number(warning.count || 0);
      } else {
        byCode.set(warning.code, { ...warning, count: Number(warning.count || 0) });
      }
    });
    return Array.from(byCode.values());
  }, [data]);

  const topProducts = data.products?.rankings?.HIGHEST_NET_PROFIT || [];
  const channelRows = data.channels?.channels || [];
  const trendRows = data.trends?.trends?.combined || [];
  const executive = data.executive;
  const sales = data.sales;
  const channelAnswer = data.channels?.answers?.mostNetProfitableChannel;

  if (loading) return <Loader message="Loading business intelligence..." />;

  return (
    <div className="admin-business-intelligence-page">
      <div className="admin-recovery-head">
        <div>
          <h2>Business Intelligence</h2>
          <p className="section-subtitle">
            Executive analytics, sales, product profit, channel profit, and trend reporting from the new accounting foundation.
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <Form.Select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Analytics period">
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Form.Select>
          <Button className="premium-btn text-white" onClick={() => load({ silent: true })} disabled={refreshing}>
            <BsArrowClockwise /> {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      <ErrorAlert error={error} />

      <Row className="g-3">
        <Col md={6} xl={3}>
          <MetricCard
            label="Collected Revenue"
            value={formatCurrency(executive?.kpis?.collectedRevenue?.value || 0, "USD")}
            detail={comparisonText(executive?.kpis?.collectedRevenue?.comparison)}
            icon={BsGraphUpArrow}
          />
        </Col>
        <Col md={6} xl={3}>
          <MetricCard
            label="Net Profit"
            value={formatCurrency(executive?.kpis?.netProfit?.value || 0, "USD")}
            detail={comparisonText(executive?.kpis?.netProfit?.comparison)}
            icon={BsBarChartLine}
          />
        </Col>
        <Col md={6} xl={3}>
          <MetricCard
            label="Confirmed Bookings"
            value={sales?.kpis?.confirmedBookings?.value || 0}
            detail={comparisonText(sales?.kpis?.confirmedBookings?.comparison)}
            icon={BsPeople}
          />
        </Col>
        <Col md={6} xl={3}>
          <MetricCard
            label="Profit Margin"
            value={formatPercent(executive?.kpis?.profitMargin?.value)}
            detail={executive?.kpis?.profitMargin?.supported === false ? executive.kpis.profitMargin.reason : "Business accounting basis"}
            icon={BsBoxes}
          />
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col xl={5}>
          <Card className="surface-card h-100">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                <div>
                  <h5 className="mb-1">Most Net Profitable Channel</h5>
                  <p className="text-muted mb-0">Ranked by net profit, not only sales.</p>
                </div>
                <Badge bg="dark">{channelAnswer?.channel || "-"}</Badge>
              </div>
              {channelAnswer ? (
                <Row className="g-3">
                  <Col sm={6}><small className="text-muted d-block">Net profit</small><strong>{formatCurrency(channelAnswer.netProfit || 0, "USD")}</strong></Col>
                  <Col sm={6}><small className="text-muted d-block">Booked revenue</small><strong>{formatCurrency(channelAnswer.bookedRevenue || 0, "USD")}</strong></Col>
                  <Col sm={6}><small className="text-muted d-block">Margin</small><strong>{formatPercent(channelAnswer.profitMargin)}</strong></Col>
                  <Col sm={6}><small className="text-muted d-block">Bookings</small><strong>{channelAnswer.confirmedBookings || 0}</strong></Col>
                </Row>
              ) : (
                <p className="text-muted mb-0">No channel profit data for this period.</p>
              )}
            </Card.Body>
          </Card>
        </Col>
        <Col xl={7}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Channel Profit Comparison</h5>
              <Table responsive hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th className="text-end">Bookings</th>
                    <th className="text-end">Sales</th>
                    <th className="text-end">Net Profit</th>
                    <th className="text-end">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {channelRows.length ? channelRows.slice(0, 8).map((row) => (
                    <tr key={row.channel}>
                      <td>{row.label || row.channel}</td>
                      <td className="text-end">{row.confirmedBookings}</td>
                      <td className="text-end">{formatCurrency(row.bookedRevenue || 0, "USD")}</td>
                      <td className="text-end">{formatCurrency(row.netProfit || 0, "USD")}</td>
                      <td className="text-end">{formatPercent(row.profitMargin)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={5} className="text-center text-muted py-4">No channel data.</td></tr>
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col xl={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Top Products by Net Profit</h5>
              <Table responsive hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-end">Bookings</th>
                    <th className="text-end">Revenue</th>
                    <th className="text-end">Net Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.length ? topProducts.slice(0, 8).map((row) => (
                    <tr key={row.productId}>
                      <td>{row.productTitle || row.productId}</td>
                      <td className="text-end">{row.confirmedBookings}</td>
                      <td className="text-end">{formatCurrency(row.bookedRevenue || 0, "USD")}</td>
                      <td className="text-end">{formatCurrency(row.netContribution || 0, "USD")}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4} className="text-center text-muted py-4">No product profit data.</td></tr>
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
        <Col xl={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Trend Summary</h5>
              <Table responsive hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th className="text-end">Bookings</th>
                    <th className="text-end">Collected</th>
                    <th className="text-end">Refunds</th>
                    <th className="text-end">Net Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {trendRows.length ? trendRows.slice(-8).map((row) => (
                    <tr key={row.bucket}>
                      <td>{row.bucket}</td>
                      <td className="text-end">{safeNumber(row.confirmedBookings)}</td>
                      <td className="text-end">{formatCurrency(row.collectedRevenue || 0, "USD")}</td>
                      <td className="text-end">{formatCurrency(row.refundedAmount || 0, "USD")}</td>
                      <td className="text-end">{formatCurrency(row.netProfit || 0, "USD")}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={5} className="text-center text-muted py-4">No trend data.</td></tr>
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col lg={12}>
          <DataWarnings warnings={warnings} />
        </Col>
      </Row>
    </div>
  );
};

export default AdminBusinessIntelligencePage;
