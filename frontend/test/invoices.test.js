import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceDateParams, invoiceIsOverdue, invoiceMoney, invoicePageCsv, normalizeInvoiceDetail, summarizeInvoicePage, validInvoiceDates } from '../src/components/invoice/invoiceView.js';

test('invoice details preserve canonical decimal balances including authoritative zero', () => {
  const invoice = normalizeInvoiceDetail({ transactionCurrency: 'TZS', accountingCurrency: 'TZS', currency: 'USD', totalAmount: { $numberDecimal: '123.45' }, total: 100, balanceDueAmount: { $numberDecimal: '0' }, balanceDue: 90, paidAccountingAmount: { $numberDecimal: '110' }, refundedAccountingAmount: { $numberDecimal: '5' }, netAccountingAmount: { $numberDecimal: '105' } });
  assert.equal(invoice.total, 123.45);
  assert.equal(invoice.balanceDue, 0);
  assert.equal(invoice.netAmountPaid, 105);
  assert.equal(invoice.currency, 'TZS');
  assert.equal(normalizeInvoiceDetail({}).balanceDue, null);
  assert.match(invoiceMoney(invoice.total, invoice.currency), /TZS.*123\.45/);
  assert.equal(invoiceMoney(null, 'USD'), '—');
});

test('frontend money formatting follows record ISO transaction currency', () => {
  const usd = normalizeInvoiceDetail({ transactionCurrency: 'USD', accountingCurrency: 'EUR', totalAmount: 70 });
  const eur = normalizeInvoiceDetail({ transactionCurrency: 'EUR', accountingCurrency: 'USD', totalAmount: 70 });
  const tzs = normalizeInvoiceDetail({ transactionCurrency: 'TZS', accountingCurrency: 'USD', totalAmount: 70 });
  assert.equal(usd.currency, 'USD');
  assert.equal(eur.currency, 'EUR');
  assert.equal(tzs.currency, 'TZS');
  assert.match(invoiceMoney(70, usd.currency), /\$70\.00|USD.*70\.00/);
  assert.match(invoiceMoney(70, eur.currency), /€70\.00|EUR.*70\.00/);
  assert.match(invoiceMoney(70, tzs.currency), /TZS.*70\.00/);
});

test('page summary sums supplied amounts per currency without recalculating balances', () => {
  const groups = summarizeInvoicePage([
    { currency: 'USD', total: 0.1, amountPaid: 0, amountRefunded: 0, balanceDue: 0 },
    { currency: 'USD', total: 0.2, amountPaid: 0, amountRefunded: 0, balanceDue: 0 },
    { currency: 'TZS', total: 1000, amountPaid: 700, amountRefunded: 100, balanceDue: 222 }
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].total, 0.3);
  assert.equal(groups[0].balanceDue, 0);
  assert.equal(groups[1].balanceDue, 222);
});

test('issue-date filters include the final day and reject impossible/reversed dates', () => {
  assert.equal(validInvoiceDates('2026-02-30', '2026-03-01'), false);
  assert.equal(validInvoiceDates('2026-09-09', '2026-09-02'), false);
  assert.equal(validInvoiceDates('', ''), true);
  const range = invoiceDateParams('2026-09-02', '2026-09-09');
  assert.equal(new Date(range.fromDate).toISOString(), '2026-09-01T21:00:00.000Z');
  assert.equal(new Date(range.toDate).toISOString(), '2026-09-09T20:59:59.999Z');
});

test('past-due indicator requires both a stored due date and positive backend balance', () => {
  const now = new Date('2026-09-09T10:00:00Z');
  assert.equal(invoiceIsOverdue({ dueDate: '2026-09-02', balanceDue: 10 }, now), true);
  assert.equal(invoiceIsOverdue({ dueDate: '2026-09-02', balanceDue: 0 }, now), false);
  assert.equal(invoiceIsOverdue({ balanceDue: 100 }, now), false);
});

test('CSV retains currency, authoritative balance, and escapes spreadsheet formulas', () => {
  const csv = invoicePageCsv([{ invoiceNumber: 'INV-1', clientName: '=HYPERLINK("bad")', currency: 'USD', total: 100, balanceDue: 37 }]);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"USD","100"/);
  assert.match(csv, /"37"/);
  assert.equal(csv.split('\r\n').length, 2);
});
