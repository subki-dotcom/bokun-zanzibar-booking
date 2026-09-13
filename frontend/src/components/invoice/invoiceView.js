import { dateLabel, formatMoney, formatNumber, humanize } from '../admin/bi/biHelpers.js';

// Payment status values from the existing Invoice model. Overdue/cancelled are
// not payment-status API filters; cancelled belongs to the booking relationship.
export const INVOICE_STATUSES = ['pending', 'partial', 'paid', 'refunded', 'partially_refunded', 'overpaid', 'initiated', 'processing', 'failed', 'reversed', 'verification_error'];
export { dateLabel, humanize };
export const numericAmount = (value) => {
  const raw = value && typeof value === 'object' ? value.$numberDecimal : value;
  if (raw === null || raw === undefined || raw === '') return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
};
export const normalizeInvoiceDetail = (invoice = {}) => ({
  ...invoice,
  currency: invoice.transactionCurrency || invoice.currency || invoice.accountingCurrency || '',
  total: numericAmount(invoice.totalAmount ?? invoice.total),
  amountPaid: numericAmount(invoice.paidAccountingAmount ?? invoice.amountPaid),
  amountRefunded: numericAmount(invoice.refundedAccountingAmount ?? invoice.amountRefunded),
  netAmountPaid: numericAmount(invoice.netAccountingAmount ?? invoice.netAmountPaid),
  balanceDue: numericAmount(invoice.balanceDueAmount ?? invoice.balanceDue)
});
export const invoiceMoney = (value, currency) => {
  const amount = numericAmount(value);
  if (amount === null) return '—';
  if (!currency) return `${formatNumber(amount, 2)} (currency unavailable)`;
  try { return formatMoney(amount, currency); } catch { return `${formatNumber(amount, 2)} (${currency})`; }
};
export const invoiceIsOverdue = (invoice, now = new Date()) => Boolean(invoice.dueDate && new Date(invoice.dueDate) < now && numericAmount(invoice.balanceDue) > 0);
export const statusTone = (status) => ({ paid: 'green', overpaid: 'green', partial: 'blue', pending: 'amber', initiated: 'amber', processing: 'blue', refunded: 'purple', partially_refunded: 'purple', failed: 'red', verification_error: 'red' })[status] || 'gray';
export const bookingHref = (reference) => `/admin/operations/bookings?search=${encodeURIComponent(reference)}`;

// Presentation-only sums of already calculated invoice fields. Never mix currencies
// or derive a new balance, net payment or invoice status in the browser.
export const summarizeInvoicePage = (items) => {
  const groups = new Map();
  for (const invoice of items) {
    const currency = invoice.currency || '';
    if (!groups.has(currency)) groups.set(currency, { currency, count: 0, total: 0, amountPaid: 0, amountRefunded: 0, balanceDue: 0 });
    const group = groups.get(currency);
    group.count += 1;
    for (const field of ['total', 'amountPaid', 'amountRefunded', 'balanceDue']) {
      const amount = numericAmount(invoice[field]);
      group[field] = group[field] === null || amount === null ? null : group[field] + Math.round(amount * 100);
    }
  }
  return [...groups.values()].map(group => Object.fromEntries(Object.entries(group).map(([key, value]) => [key, ['total', 'amountPaid', 'amountRefunded', 'balanceDue'].includes(key) && value !== null ? value / 100 : value])));
};

export const validInvoiceDates = (from, to) => {
  const valid = value => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime()) && new Date(value).toISOString().slice(0, 10) === value);
  return valid(from) && valid(to) && (!from || !to || from <= to);
};
export const invoiceDateParams = (from, to) => ({
  ...(from ? { fromDate: `${from}T00:00:00.000+03:00` } : {}),
  ...(to ? { toDate: `${to}T23:59:59.999+03:00` } : {})
});
const csvCell = (value) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
export const invoicePageCsv = (items) => {
  const columns = [['invoiceNumber', 'Invoice'], ['bookingReference', 'Booking'], ['clientName', 'Customer'], ['bookingPayment.status', 'Customer payment'], ['bookingPayment.source', 'Payment source'], ['salesChannel', 'Channel'], ['settlement.status', 'Settlement'], ['paymentStatus', 'Local accounting status'], ['bookingStatus', 'Booking status'], ['currency', 'Currency'], ['total', 'Total'], ['amountPaid', 'Paid'], ['amountRefunded', 'Refunded'], ['netAmountPaid', 'Net paid'], ['balanceDue', 'Balance'], ['issueDate', 'Issued'], ['dueDate', 'Due'], ['updatedAt', 'Updated']];
  return '\uFEFF' + [columns.map(([, label]) => csvCell(label)).join(','), ...items.map(item => columns.map(([key]) => csvCell(key.split('.').reduce((value, part) => value?.[part], item))).join(','))].join('\r\n');
};
