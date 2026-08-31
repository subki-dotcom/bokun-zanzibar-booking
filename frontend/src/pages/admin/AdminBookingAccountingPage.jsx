import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Col, Row, Table } from "react-bootstrap";
import { Link, useLocation } from "react-router-dom";
import {
  BsArrowClockwise,
  BsCashCoin,
  BsClipboard2Check,
  BsCreditCard2Front,
  BsExclamationTriangle,
  BsGraphUpArrow,
  BsReceipt
} from "react-icons/bs";
import {
  fetchBookingAccountingCostTemplates,
  fetchBookingAccountingDashboard,
  fetchBookingAccountingExpenses,
  fetchBookingAccountingInvoices,
  fetchBookingAccountingProfitability,
  fetchBookingAccountingReconciliation,
  fetchBookingAccountingRefunds
} from "../../api/adminApi";
import { AdminMetricCard, StatusBadge, formatDateTime } from "../../components/admin/AdminDataWidgets";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import { formatCurrency } from "../../utils/formatters";
import {
  BOOKING_ACCOUNTING_VIEW_CONFIG,
  bookingAccountingModeFromPath
} from "./bookingAccountingView";

const asArray = (value) => (Array.isArray(value) ? value : []);
const safeNumber = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value, currency = "USD") => formatCurrency(safeNumber(value), currency || "USD");
const percent = (value) => `${safeNumber(value).toFixed(2)}%`;
const label = (value = "") => String(value || "-").replaceAll("_", " ");

const formatReference = (value = "") => {
  const text = String(value || "");
  return text.length > 18 ? `${text.slice(0, 8)}...${text.slice(-6)}` : text || "-";
};

const EmptyRow = ({ colSpan, message }) => (
  <tr>
    <td colSpan={colSpan} className="text-center text-muted py-4">{message}</td>
  </tr>
);

const AccountingTable = ({ children }) => (
  <Table responsive hover className="align-middle mb-0">
    {children}
  </Table>
);

const SectionCard = ({ title, detail = "", action = null, children }) => (
  <Card className="surface-card h-100">
    <Card.Body>
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
        <div>
          <h5 className="mb-1">{title}</h5>
          {detail ? <small className="text-muted">{detail}</small> : null}
        </div>
        {action}
      </div>
      {children}
    </Card.Body>
  </Card>
);

const InvoicesTable = ({ items = [] }) => (
  <AccountingTable>
    <thead>
      <tr>
        <th>Invoice</th>
        <th>Booking</th>
        <th>Status</th>
        <th className="text-end">Total</th>
        <th className="text-end">Paid</th>
        <th className="text-end">Refunded</th>
        <th className="text-end">Balance</th>
        <th>Updated</th>
      </tr>
    </thead>
    <tbody>
      {items.length ? items.map((item) => (
        <tr key={item.id || item.invoiceNumber}>
          <td>
            <strong className="d-block">{item.invoiceNumber}</strong>
            <small className="text-muted">{item.clientName || item.clientEmail || "-"}</small>
          </td>
          <td>
            <strong className="d-block">{item.bookingReference || "-"}</strong>
            <small className="text-muted">{item.tourName || "-"}</small>
          </td>
          <td><StatusBadge value={item.paymentStatus} /></td>
          <td className="text-end">{money(item.total, item.currency)}</td>
          <td className="text-end">{money(item.amountPaid, item.currency)}</td>
          <td className="text-end">{money(item.amountRefunded, item.currency)}</td>
          <td className="text-end">{money(item.balanceDue, item.currency)}</td>
          <td>{formatDateTime(item.updatedAt || item.issueDate)}</td>
        </tr>
      )) : <EmptyRow colSpan={8} message="No invoice records found." />}
    </tbody>
  </AccountingTable>
);

const RefundsTable = ({ items = [] }) => (
  <AccountingTable>
    <thead>
      <tr>
        <th>Refund</th>
        <th>Booking</th>
        <th>Status</th>
        <th>Provider</th>
        <th className="text-end">Requested</th>
        <th className="text-end">Confirmed</th>
        <th>Provider Evidence</th>
        <th>Last Sync</th>
      </tr>
    </thead>
    <tbody>
      {items.length ? items.map((item) => (
        <tr key={item.id || item.refundReference}>
          <td>
            <strong className="d-block">{item.refundReference}</strong>
            <small className="text-muted">{formatDateTime(item.requestedAt)}</small>
          </td>
          <td>{item.bookingReference || "-"}</td>
          <td><StatusBadge value={item.status} /></td>
          <td className="text-capitalize">{item.provider || "-"}</td>
          <td className="text-end">{money(item.requestedAmount, item.currency)}</td>
          <td className="text-end">{money(item.confirmedRefundedAmount, item.currency)}</td>
          <td>
            <strong className="d-block">{formatReference(item.providerRefundReference)}</strong>
            <small className="text-muted">Request {formatReference(item.providerRefundRequestReference || item.originalTransactionReference)}</small>
          </td>
          <td>{formatDateTime(item.lastRefundSyncAt || item.completedAt || item.processingStartedAt)}</td>
        </tr>
      )) : <EmptyRow colSpan={8} message="No refund records found." />}
    </tbody>
  </AccountingTable>
);

const ExpensesTable = ({ items = [] }) => (
  <AccountingTable>
    <thead>
      <tr>
        <th>Expense</th>
        <th>Booking</th>
        <th>Category</th>
        <th>Supplier</th>
        <th>Status</th>
        <th className="text-end">Amount</th>
        <th>Date</th>
      </tr>
    </thead>
    <tbody>
      {items.length ? items.map((item) => (
        <tr key={item.id || item.expenseReference}>
          <td>
            <strong className="d-block">{item.expenseReference}</strong>
            <small className="text-muted">{item.description || "-"}</small>
          </td>
          <td>{item.bookingReference || "-"}</td>
          <td>{label(item.category)}</td>
          <td>{item.supplierName || "-"}</td>
          <td><StatusBadge value={item.status || item.paymentStatus} /></td>
          <td className="text-end">{money(item.baseCurrencyAmount ?? item.amount, item.baseCurrency || item.currency)}</td>
          <td>{formatDateTime(item.expenseDate)}</td>
        </tr>
      )) : <EmptyRow colSpan={7} message="No booking-linked expenses found." />}
    </tbody>
  </AccountingTable>
);

const ProfitabilityTable = ({ items = [] }) => (
  <AccountingTable>
    <thead>
      <tr>
        <th>Booking</th>
        <th>Channel</th>
        <th className="text-end">Collected</th>
        <th className="text-end">Refunded</th>
        <th className="text-end">Fees</th>
        <th className="text-end">Direct Cost</th>
        <th className="text-end">Gross Profit</th>
        <th className="text-end">Margin</th>
      </tr>
    </thead>
    <tbody>
      {items.length ? items.map((item) => (
        <tr key={item.bookingReference}>
          <td>
            <strong className="d-block">{item.bookingReference}</strong>
            <small className="text-muted">{item.productTitle || "-"}</small>
          </td>
          <td>{label(item.salesChannel)}</td>
          <td className="text-end">{money(item.collectedRevenue, item.currency)}</td>
          <td className="text-end">{money(item.refundedAmount, item.currency)}</td>
          <td className="text-end">{money(item.paymentProviderFees, item.currency)}</td>
          <td className="text-end">{money(item.actualDirectCost, item.currency)}</td>
          <td className="text-end">{money(item.grossProfit, item.currency)}</td>
          <td className="text-end">{percent(item.profitMargin)}</td>
        </tr>
      )) : <EmptyRow colSpan={8} message="No profitability rows found." />}
    </tbody>
  </AccountingTable>
);

const ReconciliationTable = ({ items = [] }) => (
  <AccountingTable>
    <thead>
      <tr>
        <th>Issue</th>
        <th>Record</th>
        <th>Severity</th>
        <th>Message</th>
      </tr>
    </thead>
    <tbody>
      {items.length ? items.map((item, index) => (
        <tr key={`${item.code}-${item.entityType}-${item.entityId}-${index}`}>
          <td>{label(item.code)}</td>
          <td>
            <strong className="d-block">{item.entityType}</strong>
            <small className="text-muted">{item.reference || item.entityId || "-"}</small>
          </td>
          <td><StatusBadge value={item.severity} /></td>
          <td>{item.message || "-"}</td>
        </tr>
      )) : <EmptyRow colSpan={4} message="No reconciliation issues found in this scan." />}
    </tbody>
  </AccountingTable>
);

const CostTemplatePanel = ({ data }) => (
  <Row className="g-4">
    <Col xl={5}>
      <SectionCard title="Template Storage" detail={data?.currentEvidenceSource || ""}>
        <Alert variant={data?.configured ? "success" : "warning"} className="mb-0">
          {data?.configured
            ? "Persistent product cost templates are configured."
            : data?.message || "Persistent product cost templates are not configured."}
        </Alert>
      </SectionCard>
    </Col>
    <Col xl={7}>
      <SectionCard title="Supported Cost Basis">
        <div className="d-flex flex-wrap gap-2">
          {asArray(data?.costBasisTypes).map((item) => <Badge bg="secondary" key={item}>{label(item)}</Badge>)}
        </div>
      </SectionCard>
    </Col>
    <Col xs={12}>
      <SectionCard title="Controlled Expense Categories">
        <div className="d-flex flex-wrap gap-2">
          {asArray(data?.controlledExpenseCategories).map((item) => <Badge bg="light" text="dark" key={item}>{label(item)}</Badge>)}
        </div>
      </SectionCard>
    </Col>
  </Row>
);

const AdminBookingAccountingPage = () => {
  const location = useLocation();
  const mode = bookingAccountingModeFromPath(location.pathname);
  const config = BOOKING_ACCOUNTING_VIEW_CONFIG[mode] || BOOKING_ACCOUNTING_VIEW_CONFIG.dashboard;
  const [data, setData] = useState({
    dashboard: null,
    invoices: { items: [] },
    refunds: { items: [] },
    expenses: { items: [] },
    costTemplates: null,
    profitability: { items: [], totals: {} },
    reconciliation: { items: [], summary: {} }
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const [
        dashboard,
        invoices,
        refunds,
        expenses,
        costTemplates,
        profitability,
        reconciliation
      ] = await Promise.all([
        fetchBookingAccountingDashboard({ limit: 25 }),
        fetchBookingAccountingInvoices({ limit: 100 }),
        fetchBookingAccountingRefunds({ limit: 100 }),
        fetchBookingAccountingExpenses({ limit: 100 }),
        fetchBookingAccountingCostTemplates(),
        fetchBookingAccountingProfitability({ limit: 100 }),
        fetchBookingAccountingReconciliation({ limit: 100 })
      ]);

      setData({
        dashboard,
        invoices,
        refunds,
        expenses,
        costTemplates,
        profitability,
        reconciliation
      });
    } catch (err) {
      setError(err.message || "Failed to load booking accounting");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totals = data.dashboard?.totals || {};
  const currency = data.dashboard?.currency || data.profitability?.currency || "USD";
  const tableItems = useMemo(() => ({
    invoices: data.invoices?.items || [],
    refunds: data.refunds?.items || [],
    expenses: data.expenses?.items || [],
    profitability: data.profitability?.items || [],
    reconciliation: data.reconciliation?.items || []
  }), [data]);

  if (loading) return <Loader message="Loading booking accounting..." />;

  return (
    <div className="admin-booking-accounting-page">
      <div className="admin-platform-page-header">
        <div>
          <span className="admin-platform-eyebrow">{config.eyebrow}</span>
          <h2>{config.title}</h2>
          <p>{config.subtitle}</p>
        </div>
        <Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing}>
          <BsArrowClockwise /> {refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>

      <ErrorAlert error={error} />

      <Row className="g-3 mb-4">
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Collected Revenue"
            value={money(totals.collectedRevenue, currency)}
            detail={`${totals.invoiceCount || 0} invoices`}
            icon={BsCashCoin}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Confirmed Refunded"
            value={money(totals.confirmedRefundedAmount, currency)}
            detail={`${totals.refundCount || 0} refund records`}
            icon={BsCreditCard2Front}
            status={totals.openRefundCount ? "processing" : ""}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Gross Profit"
            value={money(totals.grossProfit, currency)}
            detail={`${percent(totals.profitMargin)} margin`}
            icon={BsGraphUpArrow}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Reconciliation Issues"
            value={totals.reconciliationIssueCount || 0}
            detail={`${totals.openRefundCount || 0} open refunds`}
            icon={BsExclamationTriangle}
            status={totals.reconciliationIssueCount ? "WARNING" : "COMPLETED"}
          />
        </Col>
      </Row>

      {mode === "dashboard" ? (
        <Row className="g-4">
          <Col xl={6}>
            <SectionCard
              title="Recent Invoices"
              action={<Button as={Link} to="/admin/booking-accounting/invoices" size="sm" variant="outline-primary">Open</Button>}
            >
              <InvoicesTable items={asArray(data.dashboard?.recentInvoices)} />
            </SectionCard>
          </Col>
          <Col xl={6}>
            <SectionCard
              title="Recent Refunds"
              action={<Button as={Link} to="/admin/booking-accounting/refunds" size="sm" variant="outline-primary">Open</Button>}
            >
              <RefundsTable items={asArray(data.dashboard?.recentRefunds)} />
            </SectionCard>
          </Col>
          <Col xl={7}>
            <SectionCard
              title="Profitability"
              action={<Button as={Link} to="/admin/booking-accounting/profitability" size="sm" variant="outline-primary">Open</Button>}
            >
              <ProfitabilityTable items={asArray(data.dashboard?.profitability)} />
            </SectionCard>
          </Col>
          <Col xl={5}>
            <SectionCard
              title="Reconciliation"
              action={<Button as={Link} to="/admin/booking-accounting/reconciliation" size="sm" variant="outline-primary">Open</Button>}
            >
              <ReconciliationTable items={asArray(data.dashboard?.reconciliation)} />
            </SectionCard>
          </Col>
        </Row>
      ) : null}

      {mode === "invoices" ? (
        <SectionCard title="Invoice Records" detail={`${data.invoices?.total || 0} matching records`}>
          <InvoicesTable items={tableItems.invoices} />
        </SectionCard>
      ) : null}

      {mode === "refunds" ? (
        <SectionCard title="Refund Records" detail={`${data.refunds?.total || 0} matching records`}>
          <RefundsTable items={tableItems.refunds} />
        </SectionCard>
      ) : null}

      {mode === "expenses" ? (
        <SectionCard title="Booking-Linked Expenses" detail={`${data.expenses?.total || 0} matching records`}>
          <ExpensesTable items={tableItems.expenses} />
        </SectionCard>
      ) : null}

      {mode === "cost-templates" ? <CostTemplatePanel data={data.costTemplates} /> : null}

      {mode === "profitability" ? (
        <Row className="g-4">
          <Col md={6} xl={3}>
            <AdminMetricCard label="Net Revenue" value={money(data.profitability?.totals?.netRevenue, data.profitability?.currency)} icon={BsReceipt} />
          </Col>
          <Col md={6} xl={3}>
            <AdminMetricCard label="Direct Cost" value={money(data.profitability?.totals?.actualDirectCost, data.profitability?.currency)} icon={BsClipboard2Check} />
          </Col>
          <Col md={6} xl={3}>
            <AdminMetricCard label="Provider Fees" value={money(data.profitability?.totals?.paymentProviderFees, data.profitability?.currency)} icon={BsCreditCard2Front} />
          </Col>
          <Col md={6} xl={3}>
            <AdminMetricCard label="Margin" value={percent(data.profitability?.totals?.profitMargin)} icon={BsGraphUpArrow} />
          </Col>
          <Col xs={12}>
            <SectionCard title="Profitability by Booking" detail={`${data.profitability?.count || 0} scanned bookings`}>
              <ProfitabilityTable items={tableItems.profitability} />
            </SectionCard>
          </Col>
        </Row>
      ) : null}

      {mode === "reconciliation" ? (
        <SectionCard title="Reconciliation Issues" detail={`${data.reconciliation?.count || 0} issues in bounded scan`}>
          <ReconciliationTable items={tableItems.reconciliation} />
        </SectionCard>
      ) : null}
    </div>
  );
};

export default AdminBookingAccountingPage;
