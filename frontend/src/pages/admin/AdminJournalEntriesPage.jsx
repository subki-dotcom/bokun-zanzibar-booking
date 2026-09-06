import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Modal, Spinner } from "react-bootstrap";
import {
  BsArrowClockwise,
  BsCheck2Circle,
  BsChevronLeft,
  BsChevronRight,
  BsDownload,
  BsEye,
  BsFilter,
  BsJournalText,
  BsLightbulb,
  BsPlusLg,
  BsSearch,
  BsThreeDots,
  BsUpload,
  BsXCircle
} from "react-icons/bs";
import { Link, useSearchParams } from "react-router-dom";
import {
  createGeneralLedgerJournal,
  fetchAccountingHealth,
  fetchChartOfAccounts,
  fetchGeneralLedgerJournals,
  postGeneralLedgerJournal,
  reverseGeneralLedgerJournal
} from "../../api/adminApi";
import { formatDateTime } from "../../components/admin/AdminDataWidgets";
import ErrorAlert from "../../components/common/ErrorAlert";
import { formatCurrency } from "../../utils/formatters";

const STATUS_OPTIONS = ["DRAFT", "SUBMITTED", "PENDING_APPROVAL", "APPROVED", "POSTED", "REVERSED", "VOID"];
const SOURCE_OPTIONS = [
  "MANUAL",
  "BOOKING_ACCOUNTING",
  "BUSINESS_ACCOUNTING",
  "BOOKING",
  "INVOICE",
  "PAYMENT",
  "REFUND",
  "COMMISSION",
  "CASH_MOVEMENT"
];
const LIMITS = [10, 25, 50, 100];
const TABS = [
  { key: "all", label: "All Entries" },
  { key: "posted", label: "Posted" },
  { key: "draft", label: "Draft" },
  { key: "problems", label: "Needs Attention" }
];
const EMPTY_LINE = { accountCode: "", description: "", debit: "", credit: "" };
const DEFAULT_FORM = {
  postingDate: new Date().toISOString().slice(0, 10),
  sourceReference: "",
  description: "",
  currency: "USD",
  lines: [{ ...EMPTY_LINE }, { ...EMPTY_LINE }]
};

const labelize = (value = "") =>
  String(value || "")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const money = (value, currency = "USD") => formatCurrency(Number(value || 0), currency || "USD");

const toNumber = (value = 0) => {
  const parsed = Number.parseFloat(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const csvValue = (value = "") => `"${String(value ?? "").replace(/"/g, '""')}"`;

const downloadCsv = (rows = []) => {
  const csv = [
    ["Journal Number", "Posting Date", "Description", "Source", "Status", "Debit", "Credit", "Created By", "Posted By", "Posted At"].join(","),
    ...rows.map((row) =>
      [
        row.entryNumber,
        row.postingDate,
        row.description,
        row.sourceLabel || row.sourceModule,
        row.status,
        row.baseTotalDebit,
        row.baseTotalCredit,
        row.createdBy,
        row.postedBy,
        row.postedAt
      ].map(csvValue).join(",")
    )
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `journal-register-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

const updateQuery = (setSearchParams, updates = {}) => {
  setSearchParams((current) => {
    const next = new URLSearchParams(current);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === "" || value === null || value === undefined) next.delete(key);
      else next.set(key, String(value));
    });
    return next;
  });
};

const statusClass = (status = "") => {
  const normalized = String(status).toLowerCase();
  if (normalized === "posted") return "posted";
  if (["draft", "submitted", "pending_approval", "approved"].includes(normalized)) return "draft";
  if (normalized === "void") return "failed";
  if (normalized === "reversed") return "reversed";
  return "neutral";
};

const StatusBadge = ({ status }) => (
  <span className={`journal-status ${statusClass(status)}`}>{labelize(status)}</span>
);

const KpiCard = ({ label, value, tone, icon: Icon, detail }) => (
  <section className={`journal-kpi-card ${tone}`}>
    <span><Icon /></span>
    <div>
      <p>{label}</p>
      <strong>{value || 0}</strong>
      <small>{detail}</small>
    </div>
  </section>
);

const Skeleton = () => (
  <div className="journal-skeleton-grid">
    {Array.from({ length: 4 }).map((_, index) => <span key={index} />)}
  </div>
);

const calculateFormTotals = (lines = []) => {
  const debit = lines.reduce((total, line) => total + toNumber(line.debit), 0);
  const credit = lines.reduce((total, line) => total + toNumber(line.credit), 0);
  return {
    debit,
    credit,
    difference: Math.abs(debit - credit),
    balanced: debit > 0 && credit > 0 && Math.abs(debit - credit) < 0.000001
  };
};

const JournalDetailModal = ({ journal, onHide, onPost, onReverse, actionLoading }) => (
  <Modal show={Boolean(journal)} onHide={onHide} centered size="lg" className="journal-detail-modal">
    <Modal.Header closeButton>
      <Modal.Title>{journal?.entryNumber || "Journal Entry"}</Modal.Title>
    </Modal.Header>
    <Modal.Body>
      {journal ? (
        <div className="journal-detail">
          <div className="journal-detail-grid">
            <div><span>Date</span><strong>{formatDateTime(journal.postingDate)}</strong></div>
            <div><span>Status</span><StatusBadge status={journal.status} /></div>
            <div><span>Source</span><strong>{journal.sourceLabel || labelize(journal.sourceModule)}</strong></div>
            <div><span>Reference</span><strong>{journal.sourceReference || "-"}</strong></div>
            <div><span>Created By</span><strong>{journal.createdBy || "-"}</strong></div>
            <div><span>Posted At</span><strong>{journal.postedAt ? formatDateTime(journal.postedAt) : "-"}</strong></div>
          </div>
          <p>{journal.description}</p>
          <div className="journal-lines-table">
            <table>
              <thead><tr><th>Account</th><th>Description</th><th className="text-end">Debit</th><th className="text-end">Credit</th></tr></thead>
              <tbody>
                {(journal.lines || []).map((line) => (
                  <tr key={line.id || `${line.accountCode}-${line.debit}-${line.credit}`}>
                    <td><strong>{line.accountCode}</strong> {line.accountName}</td>
                    <td>{line.description || "-"}</td>
                    <td className="text-end">{money(line.debit, line.currency)}</td>
                    <td className="text-end">{money(line.credit, line.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="journal-detail-totals">
            <span>Total Debit <strong>{money(journal.baseTotalDebit, journal.baseCurrency)}</strong></span>
            <span>Total Credit <strong>{money(journal.baseTotalCredit, journal.baseCurrency)}</strong></span>
            <span className={journal.balanced ? "balanced" : "problem"}>{journal.balanced ? "Balanced" : `Difference ${money(journal.difference, journal.baseCurrency)}`}</span>
          </div>
        </div>
      ) : null}
    </Modal.Body>
    <Modal.Footer>
      <Button variant="outline-secondary" onClick={onHide}>Close</Button>
      {["DRAFT", "APPROVED", "PENDING_APPROVAL"].includes(journal?.status) ? (
        <Button className="journal-primary-action" onClick={() => onPost(journal)} disabled={actionLoading}>
          {actionLoading ? <Spinner size="sm" /> : null} Post
        </Button>
      ) : null}
      {journal?.status === "POSTED" ? (
        <Button variant="outline-danger" onClick={() => onReverse(journal)} disabled={actionLoading}>
          Reverse
        </Button>
      ) : null}
    </Modal.Footer>
  </Modal>
);

const JournalFormModal = ({ show, form, setForm, accounts, saving, error, onHide, onSubmit }) => {
  const totals = calculateFormTotals(form.lines);
  const updateLine = (index, patch) => {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line)
    }));
  };
  return (
    <Modal show={show} onHide={onHide} centered size="xl" className="journal-form-modal">
      <Modal.Header closeButton>
        <Modal.Title>New Journal Entry</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <ErrorAlert error={error} />
        {!accounts.length ? (
          <div className="journal-form-warning">
            Chart of Accounts must be configured before posting manual journals.
            <Link to="/admin/business-accounting/chart-of-accounts">Go to Chart of Accounts</Link>
          </div>
        ) : null}
        <div className="journal-form-grid">
          <Form.Group>
            <Form.Label>Journal Date *</Form.Label>
            <Form.Control type="date" value={form.postingDate} onChange={(event) => setForm((current) => ({ ...current, postingDate: event.target.value }))} />
          </Form.Group>
          <Form.Group>
            <Form.Label>Reference</Form.Label>
            <Form.Control value={form.sourceReference} onChange={(event) => setForm((current) => ({ ...current, sourceReference: event.target.value }))} placeholder="Optional" />
          </Form.Group>
          <Form.Group>
            <Form.Label>Currency *</Form.Label>
            <Form.Control value={form.currency} maxLength={3} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} />
          </Form.Group>
          <Form.Group>
            <Form.Label>Description *</Form.Label>
            <Form.Control value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Clear journal description" />
          </Form.Group>
        </div>
        <div className="journal-lines-editor">
          <header>
            <h3>Journal Lines</h3>
            <Button variant="outline-primary" onClick={() => setForm((current) => ({ ...current, lines: [...current.lines, { ...EMPTY_LINE }] }))}>
              <BsPlusLg /> Add Line
            </Button>
          </header>
          {form.lines.map((line, index) => (
            <div className="journal-line-card" key={index}>
              <strong>Line {index + 1}</strong>
              <Form.Select value={line.accountCode} onChange={(event) => updateLine(index, { accountCode: event.target.value })}>
                <option value="">Select account</option>
                {accounts.map((account) => (
                  <option key={account.id || account.code} value={account.code}>{account.code} - {account.name}</option>
                ))}
              </Form.Select>
              <Form.Control value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} placeholder="Line description" />
              <Form.Control
                value={line.debit}
                inputMode="decimal"
                onChange={(event) => updateLine(index, { debit: event.target.value, credit: event.target.value ? "" : line.credit })}
                placeholder="Debit"
              />
              <Form.Control
                value={line.credit}
                inputMode="decimal"
                onChange={(event) => updateLine(index, { credit: event.target.value, debit: event.target.value ? "" : line.debit })}
                placeholder="Credit"
              />
              <Button
                variant="outline-danger"
                disabled={form.lines.length <= 2}
                onClick={() => setForm((current) => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }))}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        <div className="journal-balance-preview">
          <span>Total Debit <strong>{money(totals.debit, form.currency)}</strong></span>
          <span>Total Credit <strong>{money(totals.credit, form.currency)}</strong></span>
          <span className={totals.balanced ? "balanced" : "problem"}>{totals.balanced ? "Balanced" : `Difference ${money(totals.difference, form.currency)}`}</span>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide} disabled={saving}>Cancel</Button>
        <Button variant="outline-primary" onClick={() => onSubmit({ postNow: false })} disabled={saving || !accounts.length}>
          {saving ? <Spinner size="sm" /> : null} Save Draft
        </Button>
        <Button className="journal-primary-action" onClick={() => onSubmit({ postNow: true })} disabled={saving || !accounts.length || !totals.balanced}>
          Post Journal
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

const AdminJournalEntriesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") || "all";
  const [data, setData] = useState(null);
  const [health, setHealth] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedJournal, setSelectedJournal] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const query = useMemo(() => ({
    tab,
    search: searchParams.get("search") || "",
    status: searchParams.get("status") || "",
    sourceModule: searchParams.get("sourceModule") || "",
    createdBy: searchParams.get("createdBy") || "",
    fromDate: searchParams.get("fromDate") || "",
    toDate: searchParams.get("toDate") || "",
    page: searchParams.get("page") || "1",
    limit: searchParams.get("limit") || "25",
    sortBy: searchParams.get("sortBy") || "postingDate",
    sortDirection: searchParams.get("sortDirection") || "desc",
    includeLines: true
  }), [searchParams, tab]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [journals, healthData, accountData] = await Promise.all([
        fetchGeneralLedgerJournals(query),
        fetchAccountingHealth(),
        fetchChartOfAccounts({ status: "active", limit: 1000, sortBy: "code" })
      ]);
      setData(journals);
      setHealth(healthData);
      setAccounts(accountData.items || []);
    } catch (err) {
      setError(err.message || "Unable to load journal entries.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== (searchParams.get("search") || "")) {
        updateQuery(setSearchParams, { search: searchInput, page: 1 });
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, searchParams, setSearchParams]);

  const summary = data?.summary || {};
  const pagination = data?.pagination || { page: 1, pages: 1, total: 0, from: 0, to: 0 };
  const journals = data?.items || [];
  const sort = data?.sort || { by: query.sortBy, direction: query.sortDirection };

  const submitJournal = async ({ postNow }) => {
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        postingDate: form.postingDate,
        description: form.description,
        sourceReference: form.sourceReference,
        currency: form.currency,
        requiresApproval: !postNow,
        lines: form.lines.map((line) => ({
          accountCode: line.accountCode,
          description: line.description,
          debit: line.debit || "0",
          credit: line.credit || "0"
        }))
      };
      const created = await createGeneralLedgerJournal(payload);
      if (postNow) {
        await postGeneralLedgerJournal(created.journal.id);
        setMessage("Journal entry created and posted.");
      } else {
        setMessage("Journal draft saved.");
      }
      setShowForm(false);
      setForm(DEFAULT_FORM);
      await load({ silent: true });
    } catch (err) {
      setFormError(err.message || "Failed to save journal entry.");
    } finally {
      setSaving(false);
    }
  };

  const postJournal = async (journal) => {
    setActionLoading(true);
    try {
      await postGeneralLedgerJournal(journal.id);
      setMessage(`${journal.entryNumber} posted.`);
      setSelectedJournal(null);
      await load({ silent: true });
    } catch (err) {
      setError(err.message || "Failed to post journal.");
    } finally {
      setActionLoading(false);
    }
  };

  const reverseJournal = async (journal) => {
    const reason = window.prompt(`Reason for reversing ${journal.entryNumber}`);
    if (!reason) return;
    setActionLoading(true);
    try {
      await reverseGeneralLedgerJournal(journal.id, { reason });
      setMessage(`${journal.entryNumber} reversed.`);
      setSelectedJournal(null);
      await load({ silent: true });
    } catch (err) {
      setError(err.message || "Failed to reverse journal.");
    } finally {
      setActionLoading(false);
    }
  };

  const exportJournals = async () => {
    setRefreshing(true);
    try {
      const exportData = await fetchGeneralLedgerJournals({ ...query, page: 1, limit: 1000 });
      downloadCsv(exportData.items || []);
    } catch (err) {
      setError(err.message || "Failed to export journal register.");
    } finally {
      setRefreshing(false);
    }
  };

  const changeSort = (field) => {
    updateQuery(setSearchParams, {
      sortBy: field,
      sortDirection: sort.by === field && sort.direction === "asc" ? "desc" : "asc",
      page: 1
    });
  };

  return (
    <div className="journal-entries-page">
      <div className="journal-page-header">
        <div>
          <nav aria-label="Breadcrumb"><span>Business Accounting</span><strong>Journal Entries</strong></nav>
          <h1>Journal Entries</h1>
          <p>Record and manage financial transactions using double-entry accounting.</p>
        </div>
        <div className="journal-header-actions">
          <Form.Control type="date" value={query.fromDate} onChange={(event) => updateQuery(setSearchParams, { fromDate: event.target.value, page: 1 })} aria-label="From date" />
          <Form.Control type="date" value={query.toDate} onChange={(event) => updateQuery(setSearchParams, { toDate: event.target.value, page: 1 })} aria-label="To date" />
          <Button className="journal-primary-action" onClick={() => setShowForm(true)}><BsPlusLg /> New Journal Entry</Button>
          <Button variant="outline-secondary" disabled title="Journal import requires a safe import preview service"><BsUpload /> Import</Button>
          <Button variant="outline-secondary" onClick={exportJournals} disabled={refreshing}><BsDownload /> Export</Button>
        </div>
      </div>

      <ErrorAlert error={error} />
      {message ? <div className="alert alert-success journal-message">{message}</div> : null}

      {loading ? <Skeleton /> : (
        <div className="journal-kpi-grid">
          <KpiCard label="Total Journal Entries" value={summary.total} tone="total" icon={BsJournalText} detail="Current filtered register" />
          <KpiCard label="Posted Entries" value={summary.posted} tone="posted" icon={BsCheck2Circle} detail="Finalized in ledger" />
          <KpiCard label="Draft Entries" value={summary.draft} tone="draft" icon={BsThreeDots} detail="Working or pending approval" />
          <KpiCard label="Problem Entries" value={summary.problems} tone="problem" icon={BsXCircle} detail="Unbalanced, void or incomplete" />
        </div>
      )}

      <section className="journal-card journal-list-card">
        <div className="journal-tabs" role="tablist" aria-label="Journal status tabs">
          {TABS.map((item) => {
            const count = (summary.tabs || []).find((row) => row.key === item.key)?.count ?? 0;
            return (
              <button
                type="button"
                key={item.key}
                className={tab === item.key ? "active" : ""}
                onClick={() => updateQuery(setSearchParams, { tab: item.key, page: 1 })}
                aria-current={tab === item.key ? "page" : undefined}
              >
                {item.label} ({count})
              </button>
            );
          })}
          <Button variant="outline-secondary" disabled title="Bulk posting requires a dedicated review flow">Bulk Actions</Button>
        </div>
        <div className="journal-filter-bar">
          <label className="journal-search">
            <BsSearch />
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search by reference, description, account code or amount..." />
          </label>
          <Form.Select value={query.status} onChange={(event) => updateQuery(setSearchParams, { status: event.target.value, page: 1 })} aria-label="Status filter">
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{labelize(status)}</option>)}
          </Form.Select>
          <Form.Select value={query.sourceModule} onChange={(event) => updateQuery(setSearchParams, { sourceModule: event.target.value, page: 1 })} aria-label="Source filter">
            <option value="">All Sources</option>
            {SOURCE_OPTIONS.map((source) => <option key={source} value={source}>{labelize(source)}</option>)}
          </Form.Select>
          <Form.Control value={query.createdBy} onChange={(event) => updateQuery(setSearchParams, { createdBy: event.target.value, page: 1 })} placeholder="All Users" aria-label="Created by" />
          <Button variant="outline-secondary" disabled title="Advanced filters can be added when import/user directory is connected"><BsFilter /> More Filters</Button>
          <Button variant="outline-secondary" onClick={() => updateQuery(setSearchParams, { search: "", status: "", sourceModule: "", createdBy: "", fromDate: "", toDate: "", page: 1 })}>
            Reset
          </Button>
        </div>

        {journals.length ? (
          <>
            <div className="journal-table-scroll">
              <table className="journal-table">
                <thead>
                  <tr>
                    <th><input type="checkbox" aria-label="Select all journals" disabled /></th>
                    <th><button type="button" onClick={() => changeSort("entryNumber")}>Journal #</button></th>
                    <th><button type="button" onClick={() => changeSort("postingDate")}>Date</button></th>
                    <th>Description</th>
                    <th>Source</th>
                    <th><button type="button" onClick={() => changeSort("status")}>Status</button></th>
                    <th className="text-end"><button type="button" onClick={() => changeSort("baseTotalDebit")}>Debit</button></th>
                    <th className="text-end"><button type="button" onClick={() => changeSort("baseTotalCredit")}>Credit</button></th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {journals.map((journal) => (
                    <tr key={journal.id || journal.entryNumber}>
                      <td><input type="checkbox" aria-label={`Select ${journal.entryNumber}`} disabled /></td>
                      <td><button type="button" className="journal-link" onClick={() => setSelectedJournal(journal)}>{journal.entryNumber}</button></td>
                      <td>{formatDateTime(journal.postingDate)}</td>
                      <td><span title={journal.description}>{journal.description}</span></td>
                      <td>{journal.sourceLabel || labelize(journal.sourceModule)}</td>
                      <td><StatusBadge status={journal.status} /></td>
                      <td className="text-end">{money(journal.baseTotalDebit, journal.baseCurrency)}</td>
                      <td className="text-end">{money(journal.baseTotalCredit, journal.baseCurrency)}</td>
                      <td>
                        <div className="journal-row-actions">
                          <button type="button" onClick={() => setSelectedJournal(journal)} aria-label={`View ${journal.entryNumber}`}><BsEye /></button>
                          {["DRAFT", "APPROVED", "PENDING_APPROVAL"].includes(journal.status) ? (
                            <button type="button" onClick={() => postJournal(journal)} aria-label={`Post ${journal.entryNumber}`}><BsUpload /></button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="journal-mobile-list">
              {journals.map((journal) => (
                <article className="journal-mobile-card" key={journal.id || journal.entryNumber}>
                  <div>
                    <button type="button" onClick={() => setSelectedJournal(journal)}>{journal.entryNumber}</button>
                    <StatusBadge status={journal.status} />
                  </div>
                  <time>{formatDateTime(journal.postingDate)}</time>
                  <strong>{journal.description}</strong>
                  <dl>
                    <div><dt>Source</dt><dd>{journal.sourceLabel || labelize(journal.sourceModule)}</dd></div>
                    <div><dt>Debit</dt><dd>{money(journal.baseTotalDebit, journal.baseCurrency)}</dd></div>
                    <div><dt>Credit</dt><dd>{money(journal.baseTotalCredit, journal.baseCurrency)}</dd></div>
                    <div><dt>Balance</dt><dd className={journal.balanced ? "balanced" : "problem"}>{journal.balanced ? "Balanced" : "Needs review"}</dd></div>
                  </dl>
                  <Button variant="outline-primary" onClick={() => setSelectedJournal(journal)}>View</Button>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="journal-empty-state">
            <BsJournalText />
            <h3>No journal entries yet.</h3>
            <p>Create your first manual journal or allow accounting integrations to generate journals automatically.</p>
            <Button className="journal-primary-action" onClick={() => setShowForm(true)}><BsPlusLg /> New Journal Entry</Button>
          </div>
        )}

        <footer className="journal-pagination">
          <span>Showing {pagination.from || 0}-{pagination.to || 0} of {pagination.total || 0} journal entries</span>
          <div>
            <Button variant="outline-secondary" disabled={!pagination.hasPrevious} onClick={() => updateQuery(setSearchParams, { page: Math.max(1, Number(pagination.page || 1) - 1) })} aria-label="Previous page"><BsChevronLeft /></Button>
            <strong>{pagination.page || 1} / {pagination.pages || 1}</strong>
            <Button variant="outline-secondary" disabled={!pagination.hasNext} onClick={() => updateQuery(setSearchParams, { page: Number(pagination.page || 1) + 1 })} aria-label="Next page"><BsChevronRight /></Button>
            <Form.Select value={query.limit} onChange={(event) => updateQuery(setSearchParams, { limit: event.target.value, page: 1 })} aria-label="Page size">
              {LIMITS.map((limit) => <option key={limit} value={limit}>{limit} / page</option>)}
            </Form.Select>
            <Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing} aria-label="Refresh journals"><BsArrowClockwise /></Button>
          </div>
        </footer>
      </section>

      <div className="journal-support-grid">
        <section className="journal-card journal-guidelines">
          <span><BsLightbulb /></span>
          <div>
            <h2>Journal Entry Guidelines</h2>
            <ul>
              <li>Total debit must equal total credit.</li>
              <li>Select accounts from Chart of Accounts.</li>
              <li>Use clear descriptions and reference numbers.</li>
              <li>Posted entries should be reversed, not overwritten.</li>
            </ul>
          </div>
        </section>
        <section className="journal-card journal-health">
          <span><BsFilter /></span>
          <div>
            <h2>Accounting Health</h2>
            <strong>{health?.status ? labelize(health.status) : "Unknown"}</strong>
            <p>{summary.problems || 0} problem journal entries detected. {health?.checks?.unbalancedJournals || 0} unbalanced journals from accounting health.</p>
            <Link to="/admin/business-accounting/accounting-reconciliation">View Details</Link>
          </div>
        </section>
      </div>

      <JournalFormModal
        show={showForm}
        form={form}
        setForm={setForm}
        accounts={accounts}
        saving={saving}
        error={formError}
        onHide={() => setShowForm(false)}
        onSubmit={submitJournal}
      />
      <JournalDetailModal
        journal={selectedJournal}
        onHide={() => setSelectedJournal(null)}
        onPost={postJournal}
        onReverse={reverseJournal}
        actionLoading={actionLoading}
      />
    </div>
  );
};

export default AdminJournalEntriesPage;
