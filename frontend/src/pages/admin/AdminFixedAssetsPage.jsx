import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Form, Modal, Spinner } from 'react-bootstrap';
import {
  BsArrowClockwise,
  BsDownload,
  BsInfoCircleFill,
  BsLayers,
  BsPieChart,
  BsWallet2,
} from 'react-icons/bs';
import {
  createFixedAsset,
  createFixedAssetAcquisitionJournal,
  createFixedAssetDepreciationJournal,
  exportFixedAssets,
  fetchChartOfAccounts,
  fetchFixedAssets,
} from '../../api/adminApi';
import './fixedAssets.css';
const numericValue = (v) => {
  if (v == null) return NaN;
  if (typeof v === 'object' && '$numberDecimal' in v) return Number(v.$numberDecimal);
  return Number(v);
};
const money = (v, c) =>
  v == null || !c
    ? 'Unavailable'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: c,
        maximumFractionDigits: 2,
      }).format(numericValue(v));
const date = (v) =>
  v
    ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(
        new Date(v)
      )
    : '—';
const label = (v) =>
  String(v || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
const Kpi = ({ title, value, note, icon: Icon, tone = '' }) => (
  <article className={`fa-kpi ${tone}`}>
    <i>
      <Icon />
    </i>
    <div>
      <small>{title}</small>
      <strong>{value}</strong>
      <span>{note}</span>
    </div>
  </article>
);
const CategoryChart = ({ rows = [], currency }) => {
  const total = rows.reduce((s, r) => s + Number(r.cost || 0), 0),
    colors = ['#18aaa1', '#3188eb', '#68bd7d', '#f2aa37', '#d34d76', '#93a4b8'];
  let x = 0;
  const bg = rows
    .map((r, i) => {
      const a = x;
      x += total ? (Number(r.cost) / total) * 360 : 0;
      return `${colors[i % colors.length]} ${a}deg ${x}deg`;
    })
    .join(',');
  return (
    <div className="fa-category">
      {total ? (
        <div className="fa-donut" style={{ background: `conic-gradient(${bg})` }}>
          <span>
            <b>{money(total, currency)}</b>
            <small>Total cost</small>
          </span>
        </div>
      ) : (
        <p>No category values available.</p>
      )}
      <div>
        {rows.map((r, i) => (
          <p key={r.category}>
            <i style={{ background: colors[i % colors.length] }} />
            <span>
              {r.category}
              <small>
                {r.count} asset{r.count === 1 ? '' : 's'}
              </small>
            </span>
            <b>{total ? ((Number(r.cost) / total) * 100).toFixed(1) : 0}%</b>
          </p>
        ))}
      </div>
    </div>
  );
};
export default function AdminFixedAssetsPage() {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const [filters, setFilters] = useState({ search: '', category: 'all', status: 'all' });
  const [showAdd, setShowAdd] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [journalMessage, setJournalMessage] = useState('');
  const [form, setForm] = useState({
    name: '',
    assetAccount: '',
    accumulatedDepreciationAccount: '',
    depreciationExpenseAccount: '',
    purchaseCost: '',
    currency: 'USD',
    salvageValue: '0',
    usefulLifeMonths: '36',
    startDate: new Date().toISOString().slice(0, 10),
    category: '',
    location: '',
  });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      setState({ loading: false, data: await fetchFixedAssets(), error: '' });
    } catch {
      setState({ loading: false, data: null, error: 'Unable to load Fixed Assets.' });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const openAdd = async () => {
    setFormError('');
    setShowAdd(true);
    try {
      const result = await fetchChartOfAccounts({ status: 'active', includeInactive: false, limit: 1000 });
      setAccounts(result.items || []);
    } catch (error) {
      setFormError(error.message || 'Unable to load chart of accounts.');
    }
  };
  const saveAsset = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await createFixedAsset({
        name: form.name,
        assetAccount: form.assetAccount,
        accumulatedDepreciationAccount: form.accumulatedDepreciationAccount,
        depreciationExpenseAccount: form.depreciationExpenseAccount,
        purchaseCost: form.purchaseCost,
        currency: form.currency,
        salvageValue: form.salvageValue || '0',
        usefulLifeMonths: form.usefulLifeMonths,
        startDate: form.startDate,
        status: 'ACTIVE',
        metadata: { category: form.category || 'Uncategorized', location: form.location || '' },
      });
      setShowAdd(false);
      await load();
    } catch (error) {
      setFormError(error.response?.data?.message || error.message || 'Unable to create fixed asset.');
    } finally {
      setSaving(false);
    }
  };
  const generateDepreciationJournal = async (asset) => {
    setJournalMessage('');
    try {
      const result = await createFixedAssetDepreciationJournal(asset._id, {});
      setJournalMessage(result.journal?.entryNumber
        ? `Draft journal ${result.journal.entryNumber} created for review.`
        : 'Draft depreciation journal created for review.');
    } catch (error) {
      setJournalMessage(error.response?.data?.message || error.message || 'Unable to create depreciation journal.');
    }
  };
  const generateAcquisitionJournal = async (asset) => {
    setJournalMessage('');
    try {
      const result = await createFixedAssetAcquisitionJournal(asset._id, {
        fundingAccountCode: '1010',
        reason: 'Fixed asset acquisition journal generated for review',
        evidence: { evidenceNote: 'Confirm supplier invoice or payment evidence before posting.' },
      });
      setJournalMessage(
        result.journal?.entryNumber
          ? `Draft acquisition journal ${result.journal.entryNumber} created for review.`
          : 'Draft acquisition journal created for review.'
      );
    } catch (error) {
      setJournalMessage(error.response?.data?.message || error.message || 'Unable to create acquisition journal.');
    }
  };
  const d = state.data || {},
    s = d.summary || {},
    c = s.currency || '';
  const items = useMemo(() => {
    const q = filters.search.toLowerCase();
    return (d.items || []).filter(
      (r) =>
        (filters.category === 'all' || r.category === filters.category) &&
        (filters.status === 'all' || r.status === filters.status) &&
        (!q ||
          [r.assetReference, r.name, r.category, r.location].some((v) =>
            String(v || '')
              .toLowerCase()
              .includes(q)
          ))
    );
  }, [d.items, filters]);
  const download = async () => {
    const blob = await exportFixedAssets({ format: 'csv' }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'fixed-assets.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <main className="fa-page">
      <header className="fa-header">
        <div>
          <nav>
            Business Accounting / Assets / <strong>Fixed Assets</strong>
          </nav>
          <h1>Fixed Assets</h1>
          <p>Manage fixed assets, depreciation, useful life, book value, and asset history.</p>
        </div>
        <div>
          <Button onClick={openAdd}>
            + Add Asset
          </Button>
          <Button
            variant="outline-secondary"
            disabled
            title="Validated import workflow is not available"
          >
            Import
          </Button>
          <Button variant="outline-secondary" onClick={download} disabled={!d.items?.length}>
            <BsDownload /> Export
          </Button>
          <Button variant="outline-secondary" onClick={load}>
            <BsArrowClockwise /> Refresh
          </Button>
        </div>
      </header>
      {state.error ? (
        <div className="fa-error" role="alert">
          {state.error}
          <Button size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      ) : state.loading ? (
        <div className="fa-loading">
          <Spinner />
          <span>Loading asset register…</span>
        </div>
      ) : (
        <>
          {journalMessage && <div className="fa-warning" role="status">{journalMessage}</div>}
          {s.mixedCurrencies ? (
            <div className="fa-warning">
              Asset totals contain multiple currencies and cannot be consolidated without verified
              historical FX.
            </div>
          ) : null}
          {d.warnings?.map((w) => (
            <div className="fa-warning" key={w}>
              {w}
            </div>
          ))}
          <section className="fa-kpis">
            <Kpi
              title="Total Fixed Assets"
              value={money(s.totalCost, c)}
              note={`${d.count || 0} assets`}
              icon={BsLayers}
            />
            <Kpi
              title="Scheduled Depreciation"
              value={money(s.scheduledAccumulatedDepreciation, c)}
              note="Estimate; verify posted GL"
              icon={BsPieChart}
              tone="red"
            />
            <Kpi
              title="Estimated Net Book Value"
              value={money(s.netBookValue, c)}
              note="Cost less scheduled depreciation"
              icon={BsWallet2}
              tone="blue"
            />
            <Kpi
              title="Monthly Depreciation"
              value={money(s.monthlyDepreciation, c)}
              note="Straight-line schedule"
              icon={BsPieChart}
              tone="amber"
            />
          </section>
          <section className="fa-analytics">
            <article>
              <h2>Asset Value Overview</h2>
              {d.items?.length ? (
                <div className="fa-value-bars">
                  {d.items.slice(0, 12).map((r) => (
                    <div key={r.assetReference}>
                      <span
                        title={`${r.name}: ${money(r.purchaseCost, r.currency)}`}
                        style={{
                          height: `${Math.max(4, (Number(r.purchaseCost) / Math.max(...d.items.map((x) => Number(x.purchaseCost || 0)), 1)) * 150)}px`,
                        }}
                      />
                      <small>{r.assetReference}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="fa-empty">
                  Historical snapshots are unavailable. Value trends will appear when asset history
                  is recorded.
                </p>
              )}
            </article>
            <article>
              <h2>Assets by Category</h2>
              <CategoryChart rows={d.categories} currency={c} />
            </article>
          </section>
          <section className="fa-register">
            <header>
              <h2>Fixed Assets</h2>
              <div>
                <Form.Control
                  placeholder="Search assets…"
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                />
                <Form.Select
                  aria-label="Category"
                  value={filters.category}
                  onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                >
                  <option value="all">All Categories</option>
                  {(d.categories || []).map((r) => (
                    <option key={r.category}>{r.category}</option>
                  ))}
                </Form.Select>
                <Form.Select
                  aria-label="Status"
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                >
                  <option value="all">All Statuses</option>
                  {[...new Set((d.items || []).map((r) => r.status))].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </Form.Select>
              </div>
            </header>
            {items.length ? (
              <>
                <div className="fa-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Reference</th>
                        <th>Name</th>
                        <th>Category</th>
                        <th>Start Date</th>
                        <th>Cost</th>
                        <th>Scheduled Depreciation</th>
                        <th>Estimated NBV</th>
                        <th>Monthly</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((r) => (
                        <tr key={r._id || r.assetReference}>
                          <td>
                            <b>{r.assetReference}</b>
                          </td>
                          <td>{r.name}</td>
                          <td>{r.category}</td>
                          <td>{date(r.startDate)}</td>
                          <td>{money(r.purchaseCost, r.currency)}</td>
                          <td>{money(r.values?.scheduledAccumulatedDepreciation, r.currency)}</td>
                          <td>{money(r.values?.netBookValue, r.currency)}</td>
                          <td>{money(r.values?.monthlyDepreciation, r.currency)}</td>
                          <td>
                            <span className="fa-status">
                              {r.values?.fullyDepreciated ? 'Fully Depreciated' : label(r.status)}
                            </span>
                          </td>
                          <td>
                            <div className="d-flex gap-2 flex-wrap">
                              <Button size="sm" variant="outline-primary" onClick={() => generateAcquisitionJournal(r)}>
                                Acquisition journal
                              </Button>
                              <Button size="sm" variant="outline-secondary" onClick={() => generateDepreciationJournal(r)} disabled={r.status !== 'ACTIVE' || r.values?.fullyDepreciated}>
                                Depreciation journal
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="fa-mobile">
                  {items.map((r) => (
                    <article key={r._id || r.assetReference}>
                      <header>
                        <b>{r.assetReference}</b>
                        <span className="fa-status">
                          {r.values?.fullyDepreciated ? 'Fully Depreciated' : label(r.status)}
                        </span>
                      </header>
                      <h3>{r.name}</h3>
                      <p>
                        {r.category} · {date(r.startDate)}
                      </p>
                      <dl>
                        <div>
                          <dt>Cost</dt>
                          <dd>{money(r.purchaseCost, r.currency)}</dd>
                        </div>
                        <div>
                          <dt>Scheduled depreciation</dt>
                          <dd>{money(r.values?.scheduledAccumulatedDepreciation, r.currency)}</dd>
                        </div>
                        <div>
                          <dt>Estimated NBV</dt>
                          <dd>{money(r.values?.netBookValue, r.currency)}</dd>
                        </div>
                      </dl>
                      <div className="d-flex gap-2 flex-wrap">
                        <Button size="sm" variant="outline-primary" onClick={() => generateAcquisitionJournal(r)}>
                          Acquisition journal
                        </Button>
                        <Button size="sm" variant="outline-secondary" onClick={() => generateDepreciationJournal(r)} disabled={r.status !== 'ACTIVE' || r.values?.fullyDepreciated}>
                          Depreciation journal
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="fa-empty">
                <strong>No fixed assets recorded or matching these filters.</strong>
              </div>
            )}
          </section>
          <section className="fa-bottom">
            <aside>
              <BsInfoCircleFill />
              <div>
                <h2>About Fixed Assets</h2>
                <p>
                  Fixed assets are long-term tangible assets used in business operations. Posted
                  depreciation and General Ledger balances remain the financial reporting authority.
                </p>
              </div>
            </aside>
            <aside>
              <BsLayers />
              <div>
                <h2>Key Insights</h2>
                <p>
                  {d.count
                    ? `${d.categories?.[0]?.category || 'The largest category'} contains ${d.categories?.[0]?.count || 0} recorded assets. ${d.items?.filter((r) => r.values?.fullyDepreciated).length || 0} assets are fully depreciated by schedule.`
                    : 'More asset history is required to generate meaningful insights.'}
                </p>
              </div>
            </aside>
          </section>
        </>
      )}
      <Modal show={showAdd} onHide={() => !saving && setShowAdd(false)} centered>
        <Form onSubmit={saveAsset}>
          <Modal.Header closeButton={!saving}>
            <Modal.Title>Add Fixed Asset</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {formError && <div className="fa-error" role="alert">{formError}</div>}
            <Form.Group className="mb-3">
              <Form.Label>Asset name</Form.Label>
              <Form.Control required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Form.Group>
            <div className="row g-3">
              <Form.Group className="col-md-6">
                <Form.Label>Purchase cost</Form.Label>
                <Form.Control required type="number" min="0" step="0.01" value={form.purchaseCost} onChange={(e) => setForm({ ...form, purchaseCost: e.target.value })} />
              </Form.Group>
              <Form.Group className="col-md-6">
                <Form.Label>Currency</Form.Label>
                <Form.Control required maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
              </Form.Group>
              <Form.Group className="col-md-6">
                <Form.Label>Useful life (months)</Form.Label>
                <Form.Control required type="number" min="1" max="600" value={form.usefulLifeMonths} onChange={(e) => setForm({ ...form, usefulLifeMonths: e.target.value })} />
              </Form.Group>
              <Form.Group className="col-md-6">
                <Form.Label>Start date</Form.Label>
                <Form.Control required type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </Form.Group>
              <Form.Group className="col-md-6">
                <Form.Label>Fixed asset account</Form.Label>
                <Form.Select required value={form.assetAccount} onChange={(e) => setForm({ ...form, assetAccount: e.target.value })}>
                  <option value="">Select account</option>
                  {accounts.filter((a) => a.subtype === 'FIXED_ASSET').map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
                </Form.Select>
              </Form.Group>
              <Form.Group className="col-md-6">
                <Form.Label>Accumulated depreciation account</Form.Label>
                <Form.Select required value={form.accumulatedDepreciationAccount} onChange={(e) => setForm({ ...form, accumulatedDepreciationAccount: e.target.value })}>
                  <option value="">Select account</option>
                  {accounts.filter((a) => a.subtype === 'ACCUMULATED_DEPRECIATION').map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
                </Form.Select>
              </Form.Group>
              <Form.Group className="col-md-6">
                <Form.Label>Depreciation expense account</Form.Label>
                <Form.Select required value={form.depreciationExpenseAccount} onChange={(e) => setForm({ ...form, depreciationExpenseAccount: e.target.value })}>
                  <option value="">Select account</option>
                  {accounts.filter((a) => a.type === 'EXPENSE').map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
                </Form.Select>
              </Form.Group>
              <Form.Group className="col-md-6">
                <Form.Label>Category</Form.Label>
                <Form.Control value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </Form.Group>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" type="button" onClick={() => setShowAdd(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Asset'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </main>
  );
}
