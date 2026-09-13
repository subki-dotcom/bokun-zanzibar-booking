import { useCallback, useEffect, useMemo, useState } from 'react';
import { BsArrowClockwise, BsDownload, BsFileEarmarkText, BsFunnel, BsSearch, BsX } from 'react-icons/bs';
import { fetchBookingAccountingInvoices } from '../../api/adminApi';
import { fetchInvoiceByNumber } from '../../api/invoicesApi';
import useReportResource from '../../components/admin/reportCenter/useReportResource';
import { InvoiceDetailsDrawer, InvoiceError, InvoicePagination, InvoiceSkeleton, InvoiceSummaryCards, InvoiceTable } from '../../components/invoice/InvoiceRegisterComponents';
import { humanize, INVOICE_STATUSES, invoiceDateParams, invoicePageCsv, normalizeInvoiceDetail, validInvoiceDates } from '../../components/invoice/invoiceView';
import './invoices.css';

export default function AdminInvoicesPage() {
  const [filters, setFilters] = useState({ search: '', status: '', from: '', to: '', page: 1, limit: 25 });
  const [search, setSearch] = useState('');
  const [dates, setDates] = useState({ from: '', to: '' });
  const [datesOpen, setDatesOpen] = useState(false);
  const [dateError, setDateError] = useState('');
  const [selected, setSelected] = useState(null);
  const [exportNotice, setExportNotice] = useState('');
  const update = useCallback((values) => { setFilters(current => ({ ...current, page: 1, ...values })); setExportNotice(''); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { if (search.trim() !== filters.search) update({ search: search.trim() }); }, 300);
    return () => window.clearTimeout(timer);
  }, [search, filters.search, update]);
  const query = useMemo(() => ({ page: filters.page, limit: filters.limit, search: filters.search || undefined, status: filters.status || undefined, ...invoiceDateParams(filters.from, filters.to) }), [filters]);
  const fetchRows = useCallback(() => fetchBookingAccountingInvoices(query), [query]);
  const invoices = useReportResource(fetchRows);
  const items = invoices.data?.items || [];
  const total = invoices.data?.total || 0;
  useEffect(() => {
    if (!invoices.data || invoices.loading) return;
    const lastPage = Math.max(1, Math.ceil(invoices.data.total / filters.limit));
    if (filters.page > lastPage) update({ page: lastPage });
  }, [invoices.data, invoices.loading, filters.page, filters.limit, update]);
  const fetchDetail = useCallback(async () => {
    const invoice = await fetchInvoiceByNumber(selected.invoiceNumber);
    if (invoice.invoiceNumber !== selected.invoiceNumber) throw new Error('The linked booking returned a different invoice. Refresh the list before opening this invoice again.');
    return normalizeInvoiceDetail(invoice);
  }, [selected]);
  const details = useReportResource(fetchDetail, Boolean(selected?.invoiceNumber));
  const filtered = Boolean(filters.search || filters.status || filters.from || filters.to);
  const clear = () => { setSearch(''); setDates({ from: '', to: '' }); setDateError(''); update({ search: '', status: '', from: '', to: '' }); };
  const applyDates = event => {
    event.preventDefault();
    if (!validInvoiceDates(dates.from, dates.to)) { setDateError('Enter valid dates with the end on or after the start.'); return; }
    update(dates); setDateError(''); setDatesOpen(false);
  };
  const exportPage = () => {
    const url = URL.createObjectURL(new Blob([invoicePageCsv(items)], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `invoices-page-${filters.page}.csv`; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportNotice(`Exported ${items.length} invoices from page ${filters.page}.`);
  };
  const openInvoice = invoice => { setSelected(invoice); };
  return <div className="iv-page">
    <header className="iv-header"><div><p className="iv-breadcrumb">Booking Accounting <span>/</span> Invoices</p><div className="iv-title"><span><BsFileEarmarkText aria-hidden="true" /></span><div><h1>Invoices</h1><p>Manage booking invoices, payment status, balances, refunds, and customer billing.</p></div></div></div><div className="iv-header-actions"><button type="button" className="iv-button" onClick={invoices.retry} disabled={invoices.loading}><BsArrowClockwise aria-hidden="true" />Refresh</button><button type="button" className="iv-button primary" disabled={invoices.loading || !items.length || Boolean(invoices.error)} onClick={exportPage}><BsDownload aria-hidden="true" />Export page · CSV</button></div></header>
    <InvoiceSummaryCards items={items} loading={invoices.loading} />
    <p className="iv-scope">Current-page summary · Currencies are shown separately. Totals cover the invoices displayed below, not the entire register.</p>
    <section className="iv-filters" aria-label="Invoice filters"><label className="iv-search"><BsSearch aria-hidden="true" /><span className="visually-hidden">Search invoice, booking or customer</span><input type="search" maxLength={180} placeholder="Search invoice, booking or customer…" value={search} onChange={event => setSearch(event.target.value)} /></label><label><span className="visually-hidden">Local accounting status</span><select aria-label="Local accounting status" value={filters.status} onChange={event => update({ status: event.target.value })}><option value="">All accounting statuses</option>{INVOICE_STATUSES.map(status => <option key={status} value={status}>{humanize(status)}</option>)}</select></label><button type="button" className={`iv-button ${filters.from || filters.to ? 'active' : ''}`} aria-expanded={datesOpen} aria-controls="iv-dates" onClick={() => setDatesOpen(value => !value)}><BsFunnel aria-hidden="true" />{filters.from || filters.to ? 'Date filter applied' : 'Issue date range'}</button>{filtered && <button type="button" className="iv-button" onClick={clear}><BsX aria-hidden="true" />Clear</button>}</section>
    {datesOpen && <form id="iv-dates" className="iv-date-form" onSubmit={applyDates}><label>Issued from<input type="date" value={dates.from} onChange={event => setDates(current => ({ ...current, from: event.target.value }))} /></label><label>Issued through<input type="date" min={dates.from || undefined} value={dates.to} onChange={event => setDates(current => ({ ...current, to: event.target.value }))} /></label><button type="submit" className="iv-button primary">Apply dates</button><p>Inclusive issue dates · Africa/Dar_es_Salaam</p>{dateError && <p role="alert" className="iv-negative">{dateError}</p>}</form>}
    <nav className="iv-status-tabs" aria-label="Quick invoice status filters">{['', 'paid', 'pending', 'partial', 'refunded', 'partially_refunded'].map(status => <button type="button" key={status || 'all'} aria-pressed={filters.status === status} onClick={() => update({ status })}>{status ? humanize(status) : 'All'}{filters.status === status && !invoices.loading && !invoices.error && <span>{total}</span>}</button>)}</nav>
    {exportNotice && <p className="iv-export-notice" role="status">{exportNotice}</p>}
    <section className="iv-register" aria-label="Invoice register" aria-busy={invoices.loading}>
      {invoices.loading ? <InvoiceSkeleton /> : invoices.error ? <InvoiceError error={invoices.error} onRetry={invoices.retry} /> : !items.length ? <div className="iv-empty"><BsFileEarmarkText aria-hidden="true" /><h2>{filtered ? 'No invoices match these filters.' : 'No invoices found'}</h2><p>Invoices generated from bookings will appear here.</p>{filtered && <button type="button" className="iv-button" onClick={clear}>Clear filters</button>}</div> : <InvoiceTable items={items} onView={openInvoice} />}
      {!invoices.error && !invoices.loading && <InvoicePagination page={filters.page} limit={filters.limit} total={total} onPage={page => update({ page })} onLimit={limit => update({ limit })} disabled={invoices.loading} />}
    </section>
    <p className="iv-footer-note">Invoices are generated from bookings. Payment and refund balances follow the existing accounting records.</p>
    <InvoiceDetailsDrawer key={selected?.invoiceNumber || 'closed'} invoice={selected} state={details.data && details.data.invoiceNumber !== selected?.invoiceNumber ? { loading: true } : details} onClose={() => setSelected(null)} />
  </div>;
}
