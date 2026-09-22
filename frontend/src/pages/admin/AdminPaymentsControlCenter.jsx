import { useEffect, useState } from 'react';
import { Badge, Button, Card, Form, Offcanvas, Table } from 'react-bootstrap';
import { BsArrowClockwise, BsCreditCard2Front, BsEye, BsShieldCheck } from 'react-icons/bs';
import {
  fetchPaymentReconciliation,
  markPaymentReviewed,
  previewCustomerPaymentPosting,
  recheckPayment,
  syncPaymentInvoice,
} from '../../api/adminApi';
import ErrorAlert from '../../components/common/ErrorAlert';
import Loader from '../../components/common/Loader';
import ListingPagination from '../../components/tours/listing/ListingPagination';
import { formatCurrency } from '../../utils/formatters';

const label = (value = '') =>
  String(value || 'Unknown')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const variant = (value = '') => {
  const code = String(value).toUpperCase();
  if (['PAID', 'MATCHED', 'VERIFIED', 'RECEIVED', 'RECONCILED', 'NOT_APPLICABLE'].includes(code))
    return 'success';
  if (['MISMATCH', 'NEEDS_REVIEW', 'REFUNDED'].includes(code)) return 'danger';
  if (['AWAITING_SETTLEMENT_DATA', 'AWAITING_EVIDENCE'].includes(code)) return 'secondary';
  return 'warning';
};
const money = (amount, currency) =>
  amount == null ? '-' : formatCurrency(amount, currency || 'USD');
const defaultFilters = { page: 1, limit: 10, search: '', fromDate: '', toDate: '', channel: '', paymentStatus: '', settlementStatus: '', reconciliationStatus: '', currency: '', sort: 'bookingDate', order: 'desc' };

const FinancialTotals = ({ summary }) => (
  <div className="row g-3 admin-payment-stat-grid">
    <div className="col-md-3">
      <Card className="surface-card h-100">
        <Card.Body>
          <small>Total bookings</small>
          <strong>{summary.total || 0}</strong>
        </Card.Body>
      </Card>
    </div>
    <div className="col-md-9">
      <Card className="surface-card h-100">
        <Card.Body>
          <small>Financial totals by currency</small>
          <div className="d-flex flex-wrap gap-3 mt-2">
            {(summary.byCurrency || []).map((total) => (
              <div key={total.currency}>
                <strong>{total.currency}</strong>
                <small className="d-block">
                  Guest paid {money(total.guestPaid, total.currency)}
                </small>
                <small className="d-block">
                  Guest balance {money(total.guestBalance, total.currency)}
                </small>
                <small className="d-block">
                  OTA expected {money(total.otaPayoutExpected, total.currency)} · received{' '}
                  {money(total.otaPayoutReceived, total.currency)}
                </small>
              </div>
            ))}
            {!(summary.byCurrency || []).length ? (
              <span className="text-muted">No financial totals available.</span>
            ) : null}
          </div>
        </Card.Body>
      </Card>
    </div>
  </div>
);

const PaymentAccountingPreview = ({ selected }) => {
  const paymentIds = selected?.customerPayment?.paymentIds || [];
  const [paymentId, setPaymentId] = useState(paymentIds.length === 1 ? paymentIds[0] : '');
  const [state, setState] = useState({ loading: false, error: '', data: null });
  useEffect(() => {
    setPaymentId(paymentIds.length === 1 ? paymentIds[0] : '');
    setState({ loading: false, error: '', data: null });
  }, [selected?.id, paymentIds.join(',')]);
  const preview = async () => {
    if (!paymentId) return;
    setState({ loading: true, error: '', data: null });
    try {
      setState({
        loading: false,
        error: '',
        data: await previewCustomerPaymentPosting({ paymentId }),
      });
    } catch (error) {
      setState({
        loading: false,
        error: error.message || 'Unable to evaluate payment accounting.',
        data: null,
      });
    }
  };
  const eligibility = state.data?.eligibility;
  return (
    <section className="border-top pt-3 mt-3" aria-label="Customer payment accounting preview">
      <h5>Customer payment accounting</h5>
      {!paymentIds.length ? (
        <p className="text-muted mb-0">
          Preview unavailable: no verified payment record is linked to this booking.
        </p>
      ) : (
        <>
          {paymentIds.length > 1 ? (
            <Form.Select
              className="mb-2"
              value={paymentId}
              onChange={(event) => setPaymentId(event.target.value)}
              aria-label="Payment record"
            >
              <option value="">Select a payment record</option>
              {paymentIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </Form.Select>
          ) : null}
          <Button
            variant="outline-primary"
            size="sm"
            onClick={preview}
            disabled={!paymentId || state.loading}
          >
            {state.loading ? 'Evaluating...' : 'Preview accounting eligibility'}
          </Button>
          {state.error ? <p className="text-danger mt-2 mb-0">{state.error}</p> : null}
          {eligibility ? (
            <div className="mt-2 small">
              <div>
                <strong>Status:</strong>{' '}
                <Badge bg={eligibility.eligible ? 'success' : 'warning'}>
                  {label(eligibility.status)}
                </Badge>
              </div>
              <div>
                <strong>Automation:</strong> {state.data.automationEnabled ? 'Enabled' : 'Disabled'}
              </div>
              <div>
                <strong>Posting key:</strong> {eligibility.postingKey}
              </div>
              <div>
                <strong>Blockers:</strong>{' '}
                {eligibility.blockers?.length ? eligibility.blockers.map(label).join(', ') : 'None'}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
};

const AdminPaymentsControlCenter = () => {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [filters, setFilters] = useState(defaultFilters);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState('');
  const load = async (next = filters) => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      setState({ loading: false, error: '', data: await fetchPaymentReconciliation(next) });
    } catch (error) {
      setState({
        loading: false,
        error: error.message || 'Failed to load payment reconciliation.',
        data: null,
      });
    }
  };
  useEffect(() => { const timer = setTimeout(() => load(), filters.search ? 350 : 0); return () => clearTimeout(timer); }, [filters.page, filters.limit, filters.search, filters.fromDate, filters.toDate, filters.channel, filters.paymentStatus, filters.settlementStatus, filters.reconciliationStatus, filters.currency, filters.sort, filters.order]);
  const data = state.data || {
    items: [],
    counts: {},
    summary: {},
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
    pagination: {},
  };
  const paginationData = data.pagination || {
    page: data.page,
    limit: data.pageSize,
    totalRecords: data.total,
    totalPages: data.totalPages,
    hasNextPage: data.page < data.totalPages,
    hasPreviousPage: data.page > 1,
  };
  const pagination = { ...paginationData, hasPrevPage: paginationData.hasPreviousPage };
  const update = patch => setFilters(current => ({ ...current, ...patch, ...(patch.page === undefined ? { page: 1 } : {}) }));
  const action = async (key, task) => {
    setBusy(key);
    try {
      await task();
      await load();
    } catch (error) {
      setState((current) => ({ ...current, error: error.message || 'Action failed.' }));
    } finally {
      setBusy('');
    }
  };
  return (
    <main className="admin-payments-page">
      <header className="admin-recovery-head">
        <div>
          <h2>Payments</h2>
          <p className="section-subtitle">
            Guest payment and OTA payout evidence are tracked separately for each booking.
          </p>
        </div>
        <Button className="premium-btn text-white" onClick={() => load()} disabled={state.loading}>
          <BsArrowClockwise /> Refresh
        </Button>
      </header>
      <ErrorAlert error={state.error} />
      {state.loading ? (
        <Loader message="Loading financial control center..." />
      ) : (
        <>
          <FinancialTotals summary={data.summary || {}} />
          <Card className="surface-card mt-4">
            <Card.Body>
              <div className="row g-2 mb-3">
                <div className="col-lg-3">
                  <Form.Label>Search</Form.Label>
                  <Form.Control
                    value={filters.search}
                    onChange={(event) => update({ search: event.target.value })}
                    placeholder="Booking, guest or Bókun reference"
                  />
                </div>
                <div className="col-lg-2">
                  <Form.Label>Channel</Form.Label>
                  <Form.Select
                    value={filters.channel}
                    onChange={(event) => update({ channel: event.target.value })}
                  >
                    <option value="">All channels</option>
                    <option value="DIRECT_WEBSITE">Riser Direct</option>
                    <option value="GETYOURGUIDE">GetYourGuide</option>
                    <option value="VIATOR">Viator</option>
                    <option value="BOKUN_MARKETPLACE">Bokun Marketplace</option>
                    <option value="OTHER">Other</option>
                  </Form.Select>
                </div>
                <div className="col-lg-2">
                  <Form.Label>Guest payment</Form.Label>
                  <Form.Select
                    value={filters.paymentStatus}
                    onChange={(event) => update({ paymentStatus: event.target.value })}
                  >
                    <option value="">All states</option>
                    <option>PAID</option>
                    <option>PARTIALLY_PAID</option>
                    <option>UNPAID</option>
                    <option>REFUNDED</option>
                  </Form.Select>
                </div>
                <div className="col-lg-2">
                  <Form.Label>OTA payout</Form.Label>
                  <Form.Select
                    value={filters.settlementStatus}
                    onChange={(event) => update({ settlementStatus: event.target.value })}
                  >
                    <option value="">All states</option>
                    <option>AWAITING_SETTLEMENT_DATA</option>
                    <option>PENDING</option>
                    <option>PARTIALLY_RECEIVED</option>
                    <option>RECEIVED</option>
                    <option>NOT_APPLICABLE</option>
                  </Form.Select>
                </div>
                <div className="col-lg-2">
                  <Form.Label>Reconciliation</Form.Label>
                  <Form.Select
                    value={filters.reconciliationStatus}
                    onChange={(event) => update({ reconciliationStatus: event.target.value })}
                  >
                    <option value="">All results</option>
                    <option>MATCHED</option>
                    <option>PARTIAL</option>
                    <option>NEEDS_REVIEW</option>
                    <option>MISMATCH</option>
                  </Form.Select>
                </div>
                <div className="col-lg-1">
                  <Form.Label>Currency</Form.Label>
                  <Form.Select
                    value={filters.currency}
                    onChange={(event) => update({ currency: event.target.value })}
                  >
                    <option value="">All</option>
                    <option>USD</option>
                    <option>TZS</option>
                    <option>EUR</option>
                  </Form.Select>
                </div>
              </div>
              <div className="row g-2 mb-3">
                <div className="col-sm-3">
                  <Form.Label>From date</Form.Label>
                  <Form.Control
                    type="date"
                    value={filters.fromDate}
                    onChange={(event) => update({ fromDate: event.target.value })}
                  />
                </div>
                <div className="col-sm-3">
                  <Form.Label>To date</Form.Label>
                  <Form.Control
                    type="date"
                    value={filters.toDate}
                    onChange={(event) => update({ toDate: event.target.value })}
                  />
                </div>
                <div className="col-sm-2">
                  <Form.Label>Sort by</Form.Label>
                  <Form.Select
                    value={filters.sort}
                    onChange={(event) => update({ sort: event.target.value })}
                  >
                    <option value="bookingDate">Booking date</option>
                    <option value="bookingReference">Booking reference</option>
                  </Form.Select>
                </div>
                <div className="col-sm-2">
                  <Form.Label>Order</Form.Label>
                  <Form.Select
                    value={filters.order}
                    onChange={(event) => update({ order: event.target.value })}
                  >
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </Form.Select>
                </div>
                <div className="col-sm-2 d-flex align-items-end">
                  <Button variant="outline-secondary" onClick={() => setFilters(defaultFilters)}>
                    Clear filters
                  </Button>
                </div>
              </div>
              <div className="table-responsive">
                <Table hover className="align-middle admin-payment-table">
                  <thead>
                    <tr>
                      <th>Booking</th>
                      <th>Customer</th>
                      <th>Channel</th>
                      <th>Guest payment</th>
                      <th>Collector</th>
                      <th>Booking total</th>
                      <th>Guest paid</th>
                      <th>Guest balance</th>
                      <th>OTA expected</th>
                      <th>OTA received</th>
                      <th>Payout</th>
                      <th>Reconciliation</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.bookingReference}</strong>
                          <small>{row.travelDate || row.product || '-'}</small>
                        </td>
                        <td>{row.customer?.name || 'Guest'}</td>
                        <td>
                          <Badge bg="light" text="dark">
                            {row.channel?.label || 'Unknown'}
                          </Badge>
                        </td>
                        <td>
                          <Badge bg={variant(row.customerPayment?.status)}>
                            {label(row.customerPayment?.status)}
                          </Badge>
                          <small>{label(row.customerPayment?.evidenceSource)}</small>
                        </td>
                        <td>{row.collector?.label || 'Unknown'}</td>
                        <td>{money(row.amount, row.currency)}</td>
                        <td>{money(row.customerPayment?.paidAmount, row.currency)}</td>
                        <td>{money(row.customerPayment?.remainingAmount, row.currency)}</td>
                        <td>
                          {money(
                            row.settlement?.expectedAmount,
                            row.settlement?.currency || row.currency
                          )}
                        </td>
                        <td>
                          {money(
                            row.settlement?.receivedAmount,
                            row.settlement?.currency || row.currency
                          )}
                        </td>
                        <td>
                          <Badge bg={variant(row.settlement?.status)}>
                            {label(row.settlement?.status)}
                          </Badge>
                          <small>
                            {row.settlement?.evidenceCount
                              ? `${row.settlement.evidenceCount} evidence item(s)`
                              : ''}
                          </small>
                        </td>
                        <td>
                          <Badge bg={variant(row.reconciliation?.result)}>
                            {label(row.reconciliation?.result)}
                          </Badge>
                        </td>
                        <td>
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            onClick={() => setSelected(row)}
                            title="View financial evidence"
                          >
                            <BsEye />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              {!data.items.length ? (
                <div className="text-center text-muted py-4">No booking financial rows found.</div>
              ) : null}
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mt-3">
                <span>
                  Showing {data.total ? (pagination.page - 1) * pagination.limit + 1 : 0}–
                  {Math.min(pagination.page * pagination.limit, data.total)} of {data.total}{' '}
                  bookings
                </span>
                <div className="d-flex flex-wrap align-items-center gap-3">
                  <ListingPagination
                    pagination={pagination}
                    onPageChange={(page) => update({ page })}
                  />
                  <Form.Group className="d-flex align-items-center gap-2 mb-0">
                    <Form.Label className="mb-0 text-nowrap">Rows per page</Form.Label>
                    <Form.Select
                      size="sm"
                      value={filters.limit}
                      onChange={(event) => update({ limit: Number(event.target.value), page: 1 })}
                    >
                      <option value="10">10</option>
                      <option value="25">25</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                    </Form.Select>
                  </Form.Group>
                </div>
              </div>
            </Card.Body>
          </Card>
        </>
      )}
      <Offcanvas placement="end" show={Boolean(selected)} onHide={() => setSelected(null)}>
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>Financial Evidence</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {selected ? (
            <>
              <h4>{selected.bookingReference}</h4>
              <p>
                {selected.customer?.name || 'Guest'} · {selected.product || 'Service unavailable'}
              </p>
              <dl>
                <dt>Guest obligation</dt>
                <dd>
                  Total {money(selected.amount, selected.currency)} · paid{' '}
                  {money(selected.customerPayment?.paidAmount, selected.currency)} · balance{' '}
                  {money(selected.customerPayment?.remainingAmount, selected.currency)}
                </dd>
                <dt>Payment collector</dt>
                <dd>
                  {selected.collector?.label || 'Unknown'} ·{' '}
                  {label(selected.customerPayment?.evidenceSource)}
                </dd>
                <dt>OTA payout</dt>
                <dd>
                  {label(selected.settlement?.status)} · expected{' '}
                  {money(
                    selected.settlement?.expectedAmount,
                    selected.settlement?.currency || selected.currency
                  )}{' '}
                  · received{' '}
                  {money(
                    selected.settlement?.receivedAmount,
                    selected.settlement?.currency || selected.currency
                  )}
                  <br />
                  {(selected.settlement?.references || []).join(', ') ||
                    'No settlement evidence has been linked.'}
                </dd>
                <dt>Invoice</dt>
                <dd>
                  {selected.invoice?.reference || 'Not created'} ·{' '}
                  {label(selected.invoice?.paymentStatus)}
                </dd>
                <dt>Reconciliation</dt>
                <dd>
                  {label(selected.reconciliation?.result)}
                  <br />
                  {(selected.reconciliation?.reasonCodes || []).map(label).join(', ') ||
                    'No outstanding reason codes'}
                </dd>
              </dl>
              <PaymentAccountingPreview selected={selected} />
              {selected.provider?.code && selected.provider.code !== 'NOT_APPLICABLE' ? (
                <Button
                  className="me-2"
                  disabled={busy === selected.bookingReference}
                  onClick={() =>
                    action(selected.bookingReference, () =>
                      recheckPayment(selected.bookingReference)
                    )
                  }
                >
                  <BsCreditCard2Front /> Recheck provider
                </Button>
              ) : null}
              {!selected.invoice ? (
                <Button
                  variant="outline-primary"
                  className="me-2"
                  disabled={busy === selected.bookingReference}
                  onClick={() =>
                    action(selected.bookingReference, () =>
                      syncPaymentInvoice(selected.bookingReference)
                    )
                  }
                >
                  Sync invoice
                </Button>
              ) : null}
              <Button
                variant="outline-secondary"
                disabled={busy === selected.bookingReference}
                onClick={() =>
                  action(selected.bookingReference, () =>
                    markPaymentReviewed(selected.bookingReference)
                  )
                }
              >
                <BsShieldCheck /> Acknowledge review
              </Button>
            </>
          ) : null}
        </Offcanvas.Body>
      </Offcanvas>
    </main>
  );
};

export default AdminPaymentsControlCenter;
