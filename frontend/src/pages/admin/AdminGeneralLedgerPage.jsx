import { useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsCloudCheck, BsJournalCheck } from "react-icons/bs";
import { useLocation } from "react-router-dom";
import {
  fetchAccountingHealth,
  fetchAccountingPeriods,
  fetchAccountingReconciliation,
  fetchChartOfAccounts,
  fetchFixedAssets,
  fetchGeneralLedger,
  fetchGeneralLedgerJournals,
  fetchLedgerBalanceSheet,
  fetchLedgerCashFlow,
  fetchLedgerProfitLoss,
  fetchTrialBalance,
  seedAccountingMappings,
  seedChartOfAccounts
} from "../../api/adminApi";
import { AdminMetricCard, StatusBadge, formatDateTime } from "../../components/admin/AdminDataWidgets";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import { formatCurrency } from "../../utils/formatters";

const money = (value, currency = "USD") => formatCurrency(value || 0, currency || "USD");

const modeFromPath = (pathname = "") => {
  if (pathname.includes("chart-of-accounts")) return "chart";
  if (pathname.includes("journal-entries")) return "journals";
  if (pathname.includes("trial-balance")) return "trial";
  if (pathname.includes("balance-sheet")) return "balance";
  if (pathname.includes("profit-loss")) return "profit";
  if (pathname.includes("cash-flow")) return "cashflow";
  if (pathname.includes("period-close")) return "periods";
  if (pathname.includes("fixed-assets")) return "assets";
  if (pathname.includes("accounting-reconciliation")) return "reconciliation";
  if (pathname.includes("accounts-receivable")) return "ar";
  if (pathname.includes("accounts-payable")) return "ap";
  if (pathname.includes("cash-bank")) return "cashbank";
  return "ledger";
};

const titles = {
  chart: "Chart of Accounts",
  journals: "Journal Entries",
  ledger: "General Ledger",
  trial: "Trial Balance",
  balance: "Balance Sheet",
  profit: "Profit & Loss",
  cashflow: "Cash Flow",
  periods: "Period Close",
  assets: "Fixed Assets",
  reconciliation: "Accounting Reconciliation",
  ar: "Accounts Receivable",
  ap: "Accounts Payable",
  cashbank: "Cash & Bank"
};

const TableCard = ({ title, children }) => (
  <Card className="surface-card h-100">
    <Card.Body>
      <h5 className="mb-3">{title}</h5>
      {children}
    </Card.Body>
  </Card>
);

const AdminGeneralLedgerPage = () => {
  const location = useLocation();
  const mode = useMemo(() => modeFromPath(location.pathname), [location.pathname]);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const [
        chart,
        journals,
        ledger,
        trial,
        balance,
        profit,
        cashflow,
        periods,
        reconciliation,
        health,
        assets
      ] = await Promise.all([
        fetchChartOfAccounts({ includeInactive: true, limit: 1000 }),
        fetchGeneralLedgerJournals({ limit: 50 }),
        fetchGeneralLedger({ limit: 250 }),
        fetchTrialBalance(),
        fetchLedgerBalanceSheet(),
        fetchLedgerProfitLoss(),
        fetchLedgerCashFlow(),
        fetchAccountingPeriods(),
        fetchAccountingReconciliation(),
        fetchAccountingHealth(),
        fetchFixedAssets()
      ]);
      setData({ chart, journals, ledger, trial, balance, profit, cashflow, periods, reconciliation, health, assets });
    } catch (err) {
      setError(err.message || "Failed to load general ledger");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const seedFoundation = async () => {
    setActionMessage("");
    setError("");
    try {
      const [coa, mappings] = await Promise.all([
        seedChartOfAccounts({ dryRun: false }),
        seedAccountingMappings({ dryRun: false })
      ]);
      setActionMessage(`Seed complete: ${coa.createdCount || 0} accounts, ${mappings.createdCount || 0} mappings.`);
      await load({ silent: true });
    } catch (err) {
      setError(err.message || "Failed to seed accounting foundation");
    }
  };

  if (loading) return <Loader message="Loading general ledger..." />;

  const accounts = data.chart?.items || [];
  const journals = data.journals?.items || [];
  const ledgerLines = data.ledger?.items || [];
  const trialRows = data.trial?.items || [];
  const balance = data.balance || {};
  const profit = data.profit || {};
  const cashflow = data.cashflow || {};
  const periods = data.periods?.items || [];
  const assets = data.assets?.items || [];
  const health = data.health?.checks || {};

  const visibleLedgerLines = mode === "ar"
    ? ledgerLines.filter((line) => line.accountCode === "1100")
    : mode === "ap"
      ? ledgerLines.filter((line) => line.accountCode === "2010")
      : mode === "cashbank"
        ? ledgerLines.filter((line) => ["1010", "1020", "1030", "1040", "1050", "1060"].includes(line.accountCode))
        : ledgerLines;

  return (
    <div className="admin-general-ledger-page">
      <div className="admin-platform-page-header">
        <div>
          <span className="admin-platform-eyebrow">Formal General Ledger</span>
          <h2>{titles[mode]}</h2>
          <p>Double-entry accounting layer that coexists with operational and management accounting.</p>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-primary" onClick={seedFoundation}>
            <BsCloudCheck /> Seed foundation
          </Button>
          <Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing}>
            <BsArrowClockwise /> {refreshing ? "Refreshing" : "Refresh"}
          </Button>
        </div>
      </div>

      <ErrorAlert error={error} />
      {actionMessage ? <div className="alert alert-success">{actionMessage}</div> : null}

      <Row className="g-3">
        <Col md={6} xl={3}>
          <AdminMetricCard label="Chart Accounts" value={accounts.length} detail="Active and inactive accounts" icon={BsJournalCheck} />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Journals" value={journals.length} detail="Recent journal register" />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Trial Balance" value={data.trial?.balanced ? "Balanced" : "Review"} detail={data.trial?.totals?.difference || "0"} status={data.trial?.balanced ? "pass" : "warn"} />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Accounting Health" value={data.health?.status || "PASS"} detail={`${health.unbalancedJournals || 0} unbalanced journals`} status={data.health?.status || "PASS"} />
        </Col>
      </Row>

      {mode === "chart" ? (
        <Row className="g-4 mt-1">
          <Col>
            <TableCard title="Chart of Accounts">
              <Table responsive hover className="align-middle mb-0">
                <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Subtype</th><th>Parent</th><th>Status</th><th>System</th></tr></thead>
                <tbody>
                  {accounts.map((row) => (
                    <tr key={row.id || row.code}>
                      <td><strong>{row.code}</strong></td>
                      <td>{row.name}</td>
                      <td>{row.type}</td>
                      <td>{row.subtype}</td>
                      <td>{row.parentCode || "-"}</td>
                      <td><StatusBadge value={row.active ? "active" : "inactive"} /></td>
                      <td>{row.systemAccount ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableCard>
          </Col>
        </Row>
      ) : null}

      {mode === "journals" ? (
        <Row className="g-4 mt-1">
          <Col>
            <TableCard title="Journal Entries">
              <Table responsive hover className="align-middle mb-0">
                <thead><tr><th>Journal</th><th>Date</th><th>Description</th><th>Source</th><th>Status</th><th className="text-end">Debit</th><th className="text-end">Credit</th></tr></thead>
                <tbody>
                  {journals.map((row) => (
                    <tr key={row.id || row.entryNumber}>
                      <td><strong>{row.entryNumber}</strong></td>
                      <td>{formatDateTime(row.postingDate)}</td>
                      <td>{row.description}</td>
                      <td>{row.sourceModule}</td>
                      <td><StatusBadge value={row.status} /></td>
                      <td className="text-end">{money(row.baseTotalDebit, row.baseCurrency)}</td>
                      <td className="text-end">{money(row.baseTotalCredit, row.baseCurrency)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableCard>
          </Col>
        </Row>
      ) : null}

      {["ledger", "ar", "ap", "cashbank"].includes(mode) ? (
        <Row className="g-4 mt-1">
          <Col>
            <TableCard title={titles[mode]}>
              <Table responsive hover className="align-middle mb-0">
                <thead><tr><th>Date</th><th>Journal</th><th>Account</th><th>Reference</th><th>Description</th><th className="text-end">Debit</th><th className="text-end">Credit</th><th className="text-end">Running</th></tr></thead>
                <tbody>
                  {visibleLedgerLines.map((row) => (
                    <tr key={row.id || `${row.entryNumber}-${row.accountCode}`}>
                      <td>{formatDateTime(row.postingDate)}</td>
                      <td>{row.entryNumber}</td>
                      <td><strong>{row.accountCode}</strong> {row.accountName}</td>
                      <td>{row.sourceReference || "-"}</td>
                      <td>{row.description}</td>
                      <td className="text-end">{money(row.baseCurrencyDebit, row.baseCurrency)}</td>
                      <td className="text-end">{money(row.baseCurrencyCredit, row.baseCurrency)}</td>
                      <td className="text-end">{money(row.runningBalance, row.baseCurrency)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableCard>
          </Col>
        </Row>
      ) : null}

      {mode === "trial" ? (
        <Row className="g-4 mt-1">
          <Col>
            <TableCard title="Trial Balance">
              <Table responsive hover className="align-middle mb-0">
                <thead><tr><th>Code</th><th>Account</th><th className="text-end">Opening Dr</th><th className="text-end">Opening Cr</th><th className="text-end">Period Dr</th><th className="text-end">Period Cr</th><th className="text-end">Closing Dr</th><th className="text-end">Closing Cr</th></tr></thead>
                <tbody>
                  {trialRows.map((row) => (
                    <tr key={row.accountCode}>
                      <td><strong>{row.accountCode}</strong></td>
                      <td>{row.accountName}</td>
                      <td className="text-end">{money(row.openingDebit)}</td>
                      <td className="text-end">{money(row.openingCredit)}</td>
                      <td className="text-end">{money(row.periodDebit)}</td>
                      <td className="text-end">{money(row.periodCredit)}</td>
                      <td className="text-end">{money(row.closingDebit)}</td>
                      <td className="text-end">{money(row.closingCredit)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableCard>
          </Col>
        </Row>
      ) : null}

      {mode === "balance" ? (
        <Row className="g-4 mt-1">
          {["assets", "liabilities", "equity"].map((section) => (
            <Col lg={4} key={section}>
              <TableCard title={section.toUpperCase()}>
                {(balance.sections?.[section] || []).map((row) => (
                  <div className="d-flex justify-content-between border-bottom py-2" key={row.accountCode}>
                    <span>{row.accountName}</span>
                    <strong>{money(row.amount)}</strong>
                  </div>
                ))}
              </TableCard>
            </Col>
          ))}
        </Row>
      ) : null}

      {mode === "profit" ? (
        <Row className="g-4 mt-1">
          <Col>
            <TableCard title="Ledger Profit & Loss">
              {Object.entries(profit.totals || {}).map(([key, value]) => (
                <div className="d-flex justify-content-between border-bottom py-2" key={key}>
                  <span>{key.replace(/([A-Z])/g, " $1")}</span>
                  <strong>{money(value)}</strong>
                </div>
              ))}
            </TableCard>
          </Col>
        </Row>
      ) : null}

      {mode === "cashflow" ? (
        <Row className="g-4 mt-1">
          <Col>
            <TableCard title="Cash Flow Foundation">
              {Object.entries(cashflow.activities || {}).map(([key, value]) => (
                <div className="d-flex justify-content-between border-bottom py-2" key={key}>
                  <span>{key}</span>
                  <strong>{money(value)}</strong>
                </div>
              ))}
              <div className="d-flex justify-content-between pt-3"><span>Net Change</span><strong>{money(cashflow.netChange)}</strong></div>
            </TableCard>
          </Col>
        </Row>
      ) : null}

      {mode === "periods" ? (
        <Row className="g-4 mt-1">
          <Col>
            <TableCard title="Accounting Periods">
              <Table responsive hover className="align-middle mb-0">
                <thead><tr><th>Period</th><th>Start</th><th>End</th><th>Status</th><th>Closed By</th></tr></thead>
                <tbody>{periods.map((row) => <tr key={row._id || row.periodKey}><td>{row.periodKey}</td><td>{formatDateTime(row.startDate)}</td><td>{formatDateTime(row.endDate)}</td><td><StatusBadge value={row.status} /></td><td>{row.closedBy || "-"}</td></tr>)}</tbody>
              </Table>
            </TableCard>
          </Col>
        </Row>
      ) : null}

      {mode === "assets" ? (
        <Row className="g-4 mt-1">
          <Col>
            <TableCard title="Fixed Assets">
              <Table responsive hover className="align-middle mb-0">
                <thead><tr><th>Reference</th><th>Name</th><th>Status</th><th className="text-end">Cost</th><th className="text-end">Monthly Depreciation</th></tr></thead>
                <tbody>{assets.map((row) => <tr key={row._id || row.assetReference}><td>{row.assetReference}</td><td>{row.name}</td><td><StatusBadge value={row.status} /></td><td className="text-end">{money(row.purchaseCost, row.currency)}</td><td className="text-end">{money(row.depreciationPlan?.monthlyDepreciation, row.currency)}</td></tr>)}</tbody>
              </Table>
            </TableCard>
          </Col>
        </Row>
      ) : null}

      {mode === "reconciliation" ? (
        <Row className="g-4 mt-1">
          <Col>
            <TableCard title="Accounting Reconciliation">
              <div className="d-flex justify-content-between border-bottom py-2"><span>Trial Balance</span><strong>{data.reconciliation?.trialBalance?.balanced ? "Balanced" : "Review"}</strong></div>
              <div className="d-flex justify-content-between border-bottom py-2"><span>AR Control</span><strong>{money(data.reconciliation?.arControl?.ledgerBalance)}</strong></div>
              <div className="d-flex justify-content-between border-bottom py-2"><span>AP Control</span><strong>{money(data.reconciliation?.apControl?.ledgerBalance)}</strong></div>
              <div className="d-flex justify-content-between border-bottom py-2"><span>Ledger Net Profit</span><strong>{money(data.reconciliation?.managementVsLedger?.ledgerNetProfit)}</strong></div>
            </TableCard>
          </Col>
        </Row>
      ) : null}
    </div>
  );
};

export default AdminGeneralLedgerPage;
