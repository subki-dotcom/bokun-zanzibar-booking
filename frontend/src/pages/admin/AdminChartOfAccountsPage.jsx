import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Modal, Spinner } from "react-bootstrap";
import {
  BsArchive,
  BsArrowClockwise,
  BsCheck2Circle,
  BsChevronLeft,
  BsChevronRight,
  BsCloudCheck,
  BsDownload,
  BsEye,
  BsFileEarmarkArrowUp,
  BsFilter,
  BsFolder2Open,
  BsLayers,
  BsPencil,
  BsPlusLg,
  BsSearch,
  BsShieldCheck
} from "react-icons/bs";
import { Link, useSearchParams } from "react-router-dom";
import {
  createChartAccount,
  fetchAccountingHealth,
  fetchChartOfAccounts,
  fetchTrialBalance,
  seedChartOfAccounts,
  updateChartAccount
} from "../../api/adminApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import { formatDateTime } from "../../components/admin/AdminDataWidgets";

const ACCOUNT_TYPES = [
  { value: "ASSET", label: "Assets", group: "Assets" },
  { value: "LIABILITY", label: "Liabilities", group: "Liabilities" },
  { value: "EQUITY", label: "Equity", group: "Equity" },
  { value: "REVENUE", label: "Income", group: "Income" },
  { value: "COST_OF_SALES", label: "Cost of Sales", group: "Expenses" },
  { value: "EXPENSE", label: "Expenses", group: "Expenses" },
  { value: "OTHER_INCOME", label: "Other Income", group: "Other" },
  { value: "OTHER_EXPENSE", label: "Other Expenses", group: "Other" }
];

const SUBTYPES = [
  "CURRENT_ASSET",
  "NON_CURRENT_ASSET",
  "CASH",
  "BANK",
  "MOBILE_MONEY",
  "PROVIDER_CLEARING",
  "ACCOUNTS_RECEIVABLE",
  "PREPAID_EXPENSE",
  "FIXED_ASSET",
  "ACCUMULATED_DEPRECIATION",
  "CURRENT_LIABILITY",
  "ACCOUNTS_PAYABLE",
  "SUPPLIER_PAYABLE",
  "TAX_PAYABLE",
  "PAYROLL_PAYABLE",
  "CUSTOMER_DEPOSIT",
  "REFUND_PAYABLE",
  "LOAN_PAYABLE",
  "OWNER_EQUITY",
  "OWNER_CAPITAL",
  "RETAINED_EARNINGS",
  "OWNER_DRAWING",
  "OPERATING_REVENUE",
  "TOUR_REVENUE",
  "TRANSFER_REVENUE",
  "COMMISSION_REVENUE",
  "OTHER_SERVICE_REVENUE",
  "CONTRA_REVENUE",
  "DIRECT_COST",
  "DIRECT_SUPPLIER_COST",
  "DIRECT_TRANSPORT_COST",
  "DIRECT_GUIDE_COST",
  "DIRECT_BOAT_COST",
  "DIRECT_ACTIVITY_COST",
  "OPERATING_EXPENSE",
  "SALARY_EXPENSE",
  "RENT_EXPENSE",
  "MARKETING_EXPENSE",
  "SOFTWARE_EXPENSE",
  "BANK_FEE_EXPENSE",
  "PAYMENT_PROVIDER_FEE",
  "INSURANCE_EXPENSE",
  "OFFICE_EXPENSE",
  "INTEREST_INCOME",
  "OTHER_INCOME",
  "REFUNDS_AND_ALLOWANCES",
  "OTHER_EXPENSE"
];

const TABS = [
  { key: "all", label: "All Accounts", type: "" },
  { key: "assets", label: "Assets", type: "ASSET" },
  { key: "liabilities", label: "Liabilities", type: "LIABILITY" },
  { key: "equity", label: "Equity", type: "EQUITY" },
  { key: "income", label: "Income", type: "REVENUE" },
  { key: "expenses", label: "Expenses", type: "EXPENSE" },
  { key: "other", label: "Other", type: "OTHER" },
  { key: "hierarchy", label: "Account Hierarchy", type: "" }
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active Accounts" },
  { value: "all", label: "All Accounts" },
  { value: "inactive", label: "Inactive Accounts" }
];

const PAGE_LIMITS = [10, 25, 50, 100];
const DEFAULT_FORM = {
  code: "",
  name: "",
  type: "ASSET",
  subtype: "CURRENT_ASSET",
  parentAccount: "",
  description: "",
  active: true,
  allowManualPosting: true,
  currency: "",
  businessUnit: "GENERAL_COMPANY"
};

const iconByCard = {
  total: BsLayers,
  ASSET: BsFolder2Open,
  LIABILITY: BsShieldCheck,
  EQUITY: BsLayers,
  REVENUE: BsCheck2Circle,
  EXPENSE: BsArchive
};

const labelize = (value = "") =>
  String(value || "")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const pct = (value = 0) => `${Number(value || 0).toFixed(Number(value || 0) % 1 ? 1 : 0)}%`;

const buildTypeSummary = (summary = {}) => summary.byType || [];

const toCsvValue = (value = "") => `"${String(value ?? "").replace(/"/g, '""')}"`;

const downloadCsv = (rows = []) => {
  const headers = ["Code", "Name", "Type", "Subtype", "Parent", "Description", "Status", "System", "Created At", "Updated At"];
  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.code,
        row.name,
        row.type,
        row.subtype,
        row.parentLabel || row.parentCode || "",
        row.description,
        row.active ? "Active" : "Inactive",
        row.systemAccount ? "System" : "Manual",
        row.createdAt,
        row.updatedAt
      ]
        .map(toCsvValue)
        .join(",")
    )
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `chart-of-accounts-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

const updateQueryParams = (setSearchParams, updates = {}) => {
  setSearchParams((current) => {
    const next = new URLSearchParams(current);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === "" || value === null || value === undefined) next.delete(key);
      else next.set(key, String(value));
    });
    return next;
  });
};

const SummaryCard = ({ card }) => {
  const Icon = iconByCard[card.key] || BsLayers;
  return (
    <section className={`coa-kpi-card type-${String(card.key || "total").toLowerCase()}`}>
      <span className="coa-kpi-icon"><Icon /></span>
      <div>
        <span>{card.label}</span>
        <strong>{card.count || 0}</strong>
        <small>{card.key === "total" ? card.detail : `${pct(card.percentage)} of total`}</small>
      </div>
    </section>
  );
};

const Donut = ({ rows = [], total = 0 }) => {
  let cursor = 0;
  const stops = rows
    .filter((row) => row.count > 0)
    .map((row) => {
      const start = cursor;
      cursor += total ? (row.count / total) * 100 : 0;
      return `${row.color || "#94a3b8"} ${start}% ${cursor}%`;
    })
    .join(", ");
  return (
    <div className="coa-donut-wrap">
      <div
        className="coa-donut"
        style={{ background: stops ? `conic-gradient(${stops})` : "#e2e8f0" }}
        aria-label="Account structure chart"
      >
        <div>
          <strong>{total || 0}</strong>
          <span>Total Accounts</span>
        </div>
      </div>
      <div className="coa-donut-legend">
        {rows.map((row) => (
          <div key={row.type}>
            <span style={{ background: row.color }} />
            <p>{row.label}</p>
            <strong>{row.count}</strong>
            <small>{pct(row.percentage)}</small>
          </div>
        ))}
      </div>
    </div>
  );
};

const AccountStatus = ({ active }) => (
  <span className={`coa-status ${active ? "active" : "inactive"}`}>{active ? "Active" : "Inactive"}</span>
);

const SystemBadge = ({ system }) => (
  <span className={`coa-system-badge ${system ? "system" : "manual"}`}>{system ? "System" : "Manual"}</span>
);

const Skeleton = () => (
  <div className="coa-skeleton-grid">
    {Array.from({ length: 6 }).map((_, index) => <span key={index} />)}
  </div>
);

const EmptyState = ({ onAdd, onSeed }) => (
  <section className="coa-empty-state">
    <span><BsLayers /></span>
    <h3>No chart of accounts configured yet.</h3>
    <p>Create or initialize your account structure before posting formal accounting entries.</p>
    <div>
      <Button className="coa-primary-action" onClick={onSeed}><BsCloudCheck /> Initialize Standard Accounts</Button>
      <Button variant="outline-primary" onClick={onAdd}><BsPlusLg /> Add Account</Button>
    </div>
  </section>
);

const HierarchyNode = ({ node, depth = 0 }) => (
  <li>
    <div className="coa-tree-row" style={{ "--depth": depth }}>
      <strong>{node.code}</strong>
      <span>{node.name}</span>
      <small>{node.typeLabel || labelize(node.type)}</small>
      <AccountStatus active={node.active} />
    </div>
    {node.children?.length ? (
      <ul>
        {node.children.map((child) => <HierarchyNode key={child.id || child.code} node={child} depth={depth + 1} />)}
      </ul>
    ) : null}
  </li>
);

const AccountsTable = ({ accounts, onEdit, onToggleActive, sort, onSort }) => {
  const sortLabel = (field) => (sort.by === field ? (sort.direction === "asc" ? "ascending" : "descending") : "none");
  const header = (field, label) => (
    <button type="button" onClick={() => onSort(field)} aria-label={`Sort by ${label}`} aria-sort={sortLabel(field)}>
      {label}
    </button>
  );

  return (
    <>
      <div className="coa-table-scroll">
        <table className="coa-table">
          <thead>
            <tr>
              <th>{header("code", "Code")}</th>
              <th>{header("name", "Account Name")}</th>
              <th>{header("type", "Type")}</th>
              <th>Subtype</th>
              <th>Parent Account</th>
              <th>Description</th>
              <th>{header("active", "Status")}</th>
              <th>System</th>
              <th className="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((row) => (
              <tr key={row.id || row.code}>
                <td><Link to={`/admin/business-accounting/general-ledger?accountCode=${encodeURIComponent(row.code)}`}>{row.code}</Link></td>
                <td><strong>{row.name}</strong></td>
                <td>{row.typeLabel || labelize(row.type)}</td>
                <td>{labelize(row.subtype)}</td>
                <td>{row.parentLabel || row.parentCode || "-"}</td>
                <td><span title={row.description}>{row.description || "-"}</span></td>
                <td><AccountStatus active={row.active} /></td>
                <td><SystemBadge system={row.systemAccount} /></td>
                <td>
                  <div className="coa-row-actions">
                    <Link to={`/admin/business-accounting/general-ledger?accountCode=${encodeURIComponent(row.code)}`} aria-label={`View ledger for ${row.code}`}>
                      <BsEye />
                    </Link>
                    <button type="button" onClick={() => onEdit(row)} aria-label={`Edit account ${row.code}`}>
                      <BsPencil />
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleActive(row)}
                      disabled={row.systemAccount && row.active}
                      aria-label={`${row.active ? "Deactivate" : "Reactivate"} account ${row.code}`}
                    >
                      <BsArchive />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="coa-mobile-list">
        {accounts.map((row) => (
          <article className="coa-mobile-card" key={row.id || row.code}>
            <div className="coa-mobile-card-head">
              <div>
                <Link to={`/admin/business-accounting/general-ledger?accountCode=${encodeURIComponent(row.code)}`}>{row.code}</Link>
                <strong>{row.name}</strong>
              </div>
              <AccountStatus active={row.active} />
            </div>
            <p>{row.typeLabel || labelize(row.type)} - {labelize(row.subtype)}</p>
            <dl>
              <div><dt>Parent</dt><dd>{row.parentLabel || row.parentCode || "-"}</dd></div>
              <div><dt>System</dt><dd><SystemBadge system={row.systemAccount} /></dd></div>
              <div><dt>Description</dt><dd>{row.description || "-"}</dd></div>
            </dl>
            <div className="coa-mobile-card-actions">
              <Link to={`/admin/business-accounting/general-ledger?accountCode=${encodeURIComponent(row.code)}`}>View Ledger</Link>
              <button type="button" onClick={() => onEdit(row)}>Edit</button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
};

const AccountFormModal = ({ show, account, form, setForm, parents, saving, error, onHide, onSubmit }) => {
  const isSystem = Boolean(account?.systemAccount);
  return (
    <Modal show={show} onHide={onHide} centered size="lg" className="coa-account-modal">
      <Modal.Header closeButton>
        <Modal.Title>{account ? "Edit Account" : "Add Account"}</Modal.Title>
      </Modal.Header>
      <Form onSubmit={onSubmit}>
        <Modal.Body>
          <ErrorAlert error={error} />
          <div className="coa-form-grid">
            <Form.Group>
              <Form.Label>Account Code *</Form.Label>
              <Form.Control
                value={form.code}
                disabled={Boolean(account)}
                onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
                placeholder="1000"
                required
              />
            </Form.Group>
            <Form.Group>
              <Form.Label>Account Name *</Form.Label>
              <Form.Control
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Cash on Hand"
                required
              />
            </Form.Group>
            <Form.Group>
              <Form.Label>Type *</Form.Label>
              <Form.Select
                value={form.type}
                disabled={isSystem}
                onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
              >
                {ACCOUNT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label>Subtype *</Form.Label>
              <Form.Select
                value={form.subtype}
                disabled={isSystem}
                onChange={(event) => setForm((current) => ({ ...current, subtype: event.target.value }))}
              >
                {SUBTYPES.map((subtype) => <option key={subtype} value={subtype}>{labelize(subtype)}</option>)}
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label>Parent Account</Form.Label>
              <Form.Select
                value={form.parentAccount}
                disabled={isSystem}
                onChange={(event) => setForm((current) => ({ ...current, parentAccount: event.target.value }))}
              >
                <option value="">No parent account</option>
                {parents
                  .filter((parent) => parent.id !== account?.id)
                  .map((parent) => (
                    <option key={parent.id || parent.code} value={parent.id}>{parent.code} - {parent.name}</option>
                  ))}
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label>Currency</Form.Label>
              <Form.Control
                value={form.currency}
                disabled={isSystem}
                maxLength={3}
                onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
                placeholder="Optional"
              />
            </Form.Group>
          </div>
          <Form.Group className="mt-3">
            <Form.Label>Description</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Short purpose of this account"
            />
          </Form.Group>
          <div className="coa-form-switches">
            <Form.Check
              type="switch"
              label="Active"
              checked={form.active}
              disabled={isSystem && account?.active}
              onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
            />
            <Form.Check
              type="switch"
              label="Allow manual posting"
              checked={form.allowManualPosting}
              onChange={(event) => setForm((current) => ({ ...current, allowManualPosting: event.target.checked }))}
            />
          </div>
          {isSystem ? (
            <p className="coa-form-note">System accounts are protected. Structural fields cannot be changed from this form.</p>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onHide} disabled={saving}>Cancel</Button>
          <Button className="coa-primary-action" type="submit" disabled={saving}>
            {saving ? <Spinner size="sm" /> : null}
            {account ? "Save Changes" : "Create Account"}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

const AdminChartOfAccountsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "all";
  const tab = TABS.find((item) => item.key === activeTab) || TABS[0];
  const [chart, setChart] = useState(null);
  const [health, setHealth] = useState(null);
  const [trialBalance, setTrialBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const [showForm, setShowForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [parents, setParents] = useState([]);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [seedPreview, setSeedPreview] = useState(null);
  const [seeding, setSeeding] = useState(false);

  const query = useMemo(() => ({
    type: tab.type || "",
    status: searchParams.get("status") || "active",
    includeInactive: (searchParams.get("status") || "active") === "all",
    search: searchParams.get("search") || "",
    subtype: searchParams.get("subtype") || "",
    systemAccount: searchParams.get("systemAccount") || "",
    hasParent: searchParams.get("hasParent") || "",
    page: searchParams.get("page") || "1",
    limit: searchParams.get("limit") || "25",
    sortBy: searchParams.get("sortBy") || "code",
    sortDirection: searchParams.get("sortDirection") || "asc"
  }), [searchParams, tab.type]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [chartData, healthData, trialData] = await Promise.all([
        fetchChartOfAccounts(query),
        fetchAccountingHealth(),
        fetchTrialBalance()
      ]);
      setChart(chartData);
      setHealth(healthData);
      setTrialBalance(trialData);
    } catch (err) {
      setError(err.message || "Failed to load chart of accounts");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setSearchInput(searchParams.get("search") || "");
  }, [searchParams]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const current = searchParams.get("search") || "";
      if (searchInput !== current) {
        updateQueryParams(setSearchParams, { search: searchInput, page: 1 });
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, searchParams, setSearchParams]);

  const openForm = async (account = null) => {
    setFormError("");
    setEditingAccount(account);
    setForm(account ? {
      code: account.code || "",
      name: account.name || "",
      type: account.type || "ASSET",
      subtype: account.subtype || "CURRENT_ASSET",
      parentAccount: account.parentAccount || "",
      description: account.description || "",
      active: account.active !== false,
      allowManualPosting: account.allowManualPosting !== false,
      currency: account.currency || "",
      businessUnit: account.businessUnit || "GENERAL_COMPANY"
    } : DEFAULT_FORM);
    setShowForm(true);
    try {
      const parentData = await fetchChartOfAccounts({ status: "all", includeInactive: true, limit: 1000, sortBy: "code" });
      setParents(parentData.items || []);
    } catch {
      setParents(chart?.items || []);
    }
  };

  const submitForm = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        ...form,
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        currency: form.currency.trim().toUpperCase(),
        parentAccount: form.parentAccount || null
      };
      if (editingAccount) await updateChartAccount(editingAccount.id, payload);
      else await createChartAccount(payload);
      setActionMessage(editingAccount ? "Chart account updated." : "Chart account created.");
      setShowForm(false);
      await load({ silent: true });
    } catch (err) {
      setFormError(err.message || "Failed to save chart account");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (account) => {
    if (account.systemAccount && account.active) return;
    try {
      await updateChartAccount(account.id, { active: !account.active });
      setActionMessage(account.active ? "Account deactivated." : "Account reactivated.");
      await load({ silent: true });
    } catch (err) {
      setError(err.message || "Failed to update account status");
    }
  };

  const previewFoundation = async () => {
    setSeeding(true);
    setError("");
    try {
      const preview = await seedChartOfAccounts({ dryRun: true });
      setSeedPreview(preview);
      setActionMessage(`Foundation preview ready: ${preview.willCreate || 0} accounts would be created.`);
    } catch (err) {
      setError(err.message || "Failed to preview standard accounts");
    } finally {
      setSeeding(false);
    }
  };

  const applyFoundation = async () => {
    if (!seedPreview) return;
    setSeeding(true);
    setError("");
    try {
      const result = await seedChartOfAccounts({
        dryRun: false,
        reason: "Initialize Standard Accounts from Chart of Accounts dashboard"
      });
      setSeedPreview(null);
      setActionMessage(`Standard accounts initialized: ${result.createdCount || 0} created, ${result.alreadyExists || 0} already existed.`);
      await load({ silent: true });
    } catch (err) {
      setError(err.message || "Failed to initialize standard accounts");
    } finally {
      setSeeding(false);
    }
  };

  const exportFilteredAccounts = async () => {
    setRefreshing(true);
    try {
      const exportData = await fetchChartOfAccounts({ ...query, page: 1, limit: 1000 });
      downloadCsv(exportData.items || []);
    } catch (err) {
      setError(err.message || "Failed to export chart accounts");
    } finally {
      setRefreshing(false);
    }
  };

  const sort = chart?.sort || { by: query.sortBy, direction: query.sortDirection };
  const summary = chart?.summary || {};
  const pagination = chart?.pagination || { page: 1, limit: 25, pages: 1, total: 0, from: 0, to: 0 };
  const accounts = chart?.items || [];
  const typeSummary = buildTypeSummary(summary);
  const healthStatus = health?.status || "UNKNOWN";
  const trialDifference = trialBalance?.totals?.difference || "0";

  const changeSort = (field) => {
    updateQueryParams(setSearchParams, {
      sortBy: field,
      sortDirection: sort.by === field && sort.direction === "asc" ? "desc" : "asc",
      page: 1
    });
  };

  return (
    <div className="chart-accounts-page">
      <div className="chart-accounts-header">
        <div>
          <nav aria-label="Breadcrumb"><span>Business Accounting</span><strong>Chart of Accounts</strong></nav>
          <h1>Chart of Accounts</h1>
          <p>Organize and manage your account structure for accurate financial reporting.</p>
        </div>
        <div className="chart-accounts-actions">
          <Form.Select
            value={query.status}
            onChange={(event) => updateQueryParams(setSearchParams, { status: event.target.value, page: 1 })}
            aria-label="Account status filter"
          >
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Form.Select>
          <Button variant="outline-secondary" disabled title="CSV/Excel import requires import preview service">
            <BsFileEarmarkArrowUp /> Import
          </Button>
          <Button variant="outline-secondary" onClick={exportFilteredAccounts} disabled={refreshing}>
            <BsDownload /> Export
          </Button>
          <Button className="coa-primary-action" onClick={() => openForm()}>
            <BsPlusLg /> Add Account
          </Button>
        </div>
      </div>

      <ErrorAlert error={error} />
      {actionMessage ? <div className="alert alert-success chart-accounts-message">{actionMessage}</div> : null}

      <section className="coa-health-strip" aria-label="Accounting health">
        <span className={`coa-health-dot ${String(healthStatus).toLowerCase()}`} />
        <strong>Accounting Health: {labelize(healthStatus)}</strong>
        <small>Trial balance difference: {trialDifference}</small>
        <small>{health?.checks?.unbalancedJournals || 0} unbalanced journals</small>
      </section>

      {loading ? (
        <Skeleton />
      ) : (
        <div className="coa-kpi-grid">
          {(summary.primaryCards || []).map((card) => <SummaryCard key={card.key} card={card} />)}
        </div>
      )}

      <div className="coa-insight-grid">
        <section className="coa-card coa-structure-card">
          <header>
            <div>
              <h2>Account Structure</h2>
              <p>Overview of accounts by category</p>
            </div>
          </header>
          <Donut rows={typeSummary} total={summary.total || 0} />
        </section>

        <section className="coa-card coa-quick-card">
          <header><h2>Quick Actions</h2></header>
          <div className="coa-quick-grid">
            <button type="button" onClick={() => openForm()}><BsPlusLg /><span><strong>Add Account</strong><small>Create a new account</small></span></button>
            <button type="button" disabled title="Import preview service is not implemented yet"><BsFileEarmarkArrowUp /><span><strong>Import Accounts</strong><small>CSV/Excel preview required</small></span></button>
            <button type="button" onClick={exportFilteredAccounts}><BsDownload /><span><strong>Export Accounts</strong><small>Download filtered list</small></span></button>
            <button type="button" onClick={previewFoundation} disabled={seeding}><BsCloudCheck /><span><strong>Account Templates</strong><small>Preview standard foundation</small></span></button>
          </div>
        </section>

        <section className="coa-card coa-types-card">
          <header>
            <div>
              <h2>Account Types</h2>
              <p>Configured numbering structure</p>
            </div>
          </header>
          <div className="coa-numbering-list">
            {(chart?.numberingPolicy || []).map((item) => (
              <div key={item.range}>
                <strong>{item.range}</strong>
                <span>{item.label}</span>
                <small>{item.example}</small>
              </div>
            ))}
          </div>
        </section>
      </div>

      {seedPreview ? (
        <section className="coa-seed-preview">
          <div>
            <strong>Initialize Standard Accounts preview</strong>
            <span>{seedPreview.willCreate || 0} new, {seedPreview.alreadyExists || 0} already exist, {(seedPreview.warnings || []).length} warnings.</span>
          </div>
          <div>
            <Button variant="outline-secondary" onClick={() => setSeedPreview(null)}>Cancel</Button>
            <Button className="coa-primary-action" onClick={applyFoundation} disabled={seeding || !(seedPreview.willCreate > 0)}>
              {seeding ? <Spinner size="sm" /> : null} Apply Reviewed Foundation
            </Button>
          </div>
        </section>
      ) : null}

      <section className="coa-card coa-list-card">
        <div className="coa-tabs" role="tablist" aria-label="Account filters">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={item.key === tab.key ? "active" : ""}
              onClick={() => updateQueryParams(setSearchParams, { tab: item.key, page: 1 })}
              aria-current={item.key === tab.key ? "page" : undefined}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="coa-filter-bar">
          <label className="coa-search">
            <BsSearch />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search by code, account name, description..."
            />
          </label>
          <Form.Select value={query.subtype} onChange={(event) => updateQueryParams(setSearchParams, { subtype: event.target.value, page: 1 })} aria-label="Subtype filter">
            <option value="">All subtypes</option>
            {SUBTYPES.map((subtype) => <option key={subtype} value={subtype}>{labelize(subtype)}</option>)}
          </Form.Select>
          <Form.Select value={query.systemAccount} onChange={(event) => updateQueryParams(setSearchParams, { systemAccount: event.target.value, page: 1 })} aria-label="System filter">
            <option value="">All ownership</option>
            <option value="system">System</option>
            <option value="manual">Manual</option>
          </Form.Select>
          <Form.Select value={query.hasParent} onChange={(event) => updateQueryParams(setSearchParams, { hasParent: event.target.value, page: 1 })} aria-label="Hierarchy filter">
            <option value="">All levels</option>
            <option value="false">Top level</option>
            <option value="true">Has parent</option>
          </Form.Select>
          <Button variant="outline-secondary" onClick={() => updateQueryParams(setSearchParams, { subtype: "", systemAccount: "", hasParent: "", search: "", page: 1 })}>
            <BsFilter /> Reset
          </Button>
        </div>

        {tab.key === "hierarchy" ? (
          <div className="coa-tree">
            {(chart?.hierarchy || []).length ? (
              <ul>{chart.hierarchy.map((node) => <HierarchyNode key={node.id || node.code} node={node} />)}</ul>
            ) : <p>No account hierarchy available.</p>}
          </div>
        ) : accounts.length ? (
          <AccountsTable accounts={accounts} onEdit={openForm} onToggleActive={toggleActive} sort={sort} onSort={changeSort} />
        ) : (
          <EmptyState onAdd={() => openForm()} onSeed={previewFoundation} />
        )}

        <footer className="coa-pagination">
          <span>Showing {pagination.from || 0}-{pagination.to || 0} of {pagination.total || 0} accounts</span>
          <div>
            <Button
              variant="outline-secondary"
              onClick={() => updateQueryParams(setSearchParams, { page: Math.max(1, Number(pagination.page || 1) - 1) })}
              disabled={!pagination.hasPrevious}
              aria-label="Previous page"
            >
              <BsChevronLeft />
            </Button>
            <strong>{pagination.page || 1} / {pagination.pages || 1}</strong>
            <Button
              variant="outline-secondary"
              onClick={() => updateQueryParams(setSearchParams, { page: Number(pagination.page || 1) + 1 })}
              disabled={!pagination.hasNext}
              aria-label="Next page"
            >
              <BsChevronRight />
            </Button>
            <Form.Select value={query.limit} onChange={(event) => updateQueryParams(setSearchParams, { limit: event.target.value, page: 1 })} aria-label="Page size">
              {PAGE_LIMITS.map((limit) => <option key={limit} value={limit}>{limit} / page</option>)}
            </Form.Select>
            <Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing} aria-label="Refresh chart of accounts">
              <BsArrowClockwise />
            </Button>
          </div>
        </footer>
      </section>

      <AccountFormModal
        show={showForm}
        account={editingAccount}
        form={form}
        setForm={setForm}
        parents={parents}
        saving={saving}
        error={formError}
        onHide={() => setShowForm(false)}
        onSubmit={submitForm}
      />
    </div>
  );
};

export default AdminChartOfAccountsPage;
