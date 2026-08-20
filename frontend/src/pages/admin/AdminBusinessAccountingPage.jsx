import { useEffect, useState } from "react";
import { Button, Card, Col, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsCashCoin, BsGraphUpArrow, BsReceipt } from "react-icons/bs";
import {
  fetchBusinessAccountingFoundation,
  fetchBusinessExpenses,
  fetchBusinessIncome
} from "../../api/adminApi";
import { AdminMetricCard, StatusBadge, formatDateTime } from "../../components/admin/AdminDataWidgets";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import { formatCurrency } from "../../utils/formatters";

const money = (value, currency = "USD") => formatCurrency(value || 0, currency || "USD");

const rowAmount = (row = {}) => row.baseCurrencyAmount ?? row.amount ?? 0;
const rowCurrency = (row = {}) => row.baseCurrency || row.currency || "USD";

const AdminBusinessAccountingPage = () => {
  const [foundation, setFoundation] = useState(null);
  const [income, setIncome] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const [nextFoundation, nextIncome, nextExpenses] = await Promise.all([
        fetchBusinessAccountingFoundation(),
        fetchBusinessIncome({ limit: 10 }),
        fetchBusinessExpenses({ limit: 10 })
      ]);
      setFoundation(nextFoundation);
      setIncome(nextIncome.items || []);
      setExpenses(nextExpenses.items || []);
    } catch (err) {
      setError(err.message || "Failed to load business accounting");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <Loader message="Loading business accounting..." />;

  const totals = foundation?.totals || {};

  return (
    <div className="admin-business-accounting-page">
      <div className="admin-platform-page-header">
        <div>
          <span className="admin-platform-eyebrow">Management Accounting</span>
          <h2>Business Accounting</h2>
          <p>Company-wide contribution, income, and expense evidence without duplicating booking accounting revenue.</p>
        </div>
        <Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing}>
          <BsArrowClockwise /> {refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>

      <ErrorAlert error={error} />

      <Row className="g-3">
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Booking Net Contribution"
            value={money(totals.bookingNetContribution)}
            detail={`${foundation?.bookingContributionPostingCount || 0} contribution postings`}
            icon={BsGraphUpArrow}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Other Business Income"
            value={money(totals.otherBusinessIncome)}
            detail="Counted business income"
            icon={BsCashCoin}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Company Expenses"
            value={money(totals.companyExpenses)}
            detail="Operating and company-wide expenses"
            icon={BsReceipt}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Company Net Profit"
            value={money(totals.companyNetProfit)}
            detail={`${foundation?.postingCount || 0} counted postings`}
            icon={BsGraphUpArrow}
          />
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col xl={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Recent Business Income</h5>
              <Table responsive hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th className="text-end">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {income.length ? income.map((row) => (
                    <tr key={row.id || row.incomeReference}>
                      <td>
                        <strong className="d-block">{row.incomeReference}</strong>
                        <small className="text-muted">{formatDateTime(row.transactionDate)}</small>
                      </td>
                      <td>{row.incomeCategory}</td>
                      <td><StatusBadge value={row.status} /></td>
                      <td className="text-end">{money(rowAmount(row), rowCurrency(row))}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4} className="text-center text-muted py-4">No business income records found.</td></tr>
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
        <Col xl={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Recent Business Expenses</h5>
              <Table responsive hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th className="text-end">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.length ? expenses.map((row) => (
                    <tr key={row.id || row.expenseReference}>
                      <td>
                        <strong className="d-block">{row.expenseReference}</strong>
                        <small className="text-muted">{formatDateTime(row.expenseDate)}</small>
                      </td>
                      <td>{row.category}</td>
                      <td><StatusBadge value={row.status} /></td>
                      <td className="text-end">{money(rowAmount(row), rowCurrency(row))}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4} className="text-center text-muted py-4">No business expense records found.</td></tr>
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col>
          <Card className="surface-card">
            <Card.Body>
              <h5 className="mb-3">Source Link Strategy</h5>
              <div className="d-grid gap-2">
                {Object.entries(foundation?.sourceLinkStrategy || {}).map(([key, value]) => (
                  <div key={key} className="d-flex justify-content-between border rounded-3 p-2">
                    <span>{key.replaceAll("_", " ")}</span>
                    <strong>{Array.isArray(value) ? value.join(", ") : value ? "Yes" : "No"}</strong>
                  </div>
                ))}
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default AdminBusinessAccountingPage;
