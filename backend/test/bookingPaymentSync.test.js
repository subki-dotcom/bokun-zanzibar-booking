const test = require('node:test');
const assert = require('node:assert/strict');
const { syncBokunPayment, proposeBokunPayment } = require('../src/services/bookingPayment/sync');

const paid = { totalPrice: 100, totalPaid: 100, paymentType: 'PAID_IN_FULL', currency: 'USD' };
const bookingFixture = () => ({
  _id: 'booking-1', bookingReference: 'B-1', bokunBookingId: 'supplier-1',
  bookingPaymentStatus: 'UNKNOWN', bookingPaymentStatusSource: '',
  amount: 100, amountPaid: 0, amountRefunded: 0, paymentStatus: 'pending',
  financialSnapshot: { revenue: 100, settled: 0 }, invoiceId: 'invoice-1',
  pricingSnapshot: { finalPayable: 100, amountPaid: 0 }, currency: 'USD'
});
const financialFields = booking => Object.fromEntries([
  'amount', 'amountPaid', 'amountRefunded', 'paymentStatus', 'financialSnapshot', 'invoiceId', 'pricingSnapshot', 'currency'
].map(key => [key, structuredClone(booking[key])]));
const recorder = () => {
  const entries = [];
  return { entries, create: async event => { entries.push(structuredClone(event)); } };
};

test('repeated customer payment evidence produces one audit without financial mutations', async () => {
  const booking = bookingFixture();
  const financialBefore = financialFields(booking);
  const audit = recorder();
  const first = await syncBokunPayment({ booking, payload: paid, AuditLogModel: audit, now: new Date('2026-09-09T07:00:00Z') });
  const second = await syncBokunPayment({ booking, payload: paid, AuditLogModel: audit, now: new Date('2026-09-09T07:01:00Z') });
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(audit.entries.length, 1);
  assert.equal(booking.bookingPaymentStatus, 'PAID');
  assert.equal(booking.bookingPaymentStatusSource, 'BOKUN');
  assert.equal(booking.bookingPaymentReportedAmount, '100');
  assert.deepEqual(financialFields(booking), financialBefore);
  assert.equal(audit.entries[0].before.status, 'UNKNOWN');
  assert.equal(audit.entries[0].after.status, 'PAID');
  assert.equal(booking.bookingPaymentPendingAudit, null);
});

test('a supplier refund changes supplier truth without creating local cash refund', async () => {
  const booking = bookingFixture();
  const financialBefore = financialFields(booking);
  const audit = recorder();
  await syncBokunPayment({ booking, payload: paid, AuditLogModel: audit });
  await syncBokunPayment({ booking, payload: { paymentStatus: 'REFUNDED', totalPaid: 100, currency: 'USD' }, AuditLogModel: audit });
  assert.equal(booking.bookingPaymentStatus, 'REFUNDED');
  assert.equal(audit.entries.length, 2);
  assert.deepEqual(financialFields(booking), financialBefore);
});

test('audited locked overrides retain manual truth and deduplicate conflicting evidence', async () => {
  const booking = { ...bookingFixture(), bookingPaymentStatus: 'UNPAID', bookingPaymentStatusSource: 'MANUAL_OVERRIDE',
    bookingPaymentOverride: { locked: true, auditReference: 'audit-approved-1' } };
  const audit = recorder();
  await syncBokunPayment({ booking, payload: paid, AuditLogModel: audit });
  await syncBokunPayment({ booking, payload: paid, AuditLogModel: audit });
  assert.equal(booking.bookingPaymentStatus, 'UNPAID');
  assert.equal(booking.bookingPaymentStatusSource, 'MANUAL_OVERRIDE');
  assert.equal(booking.bookingPaymentConflict.proposedStatus, 'PAID');
  assert.equal(audit.entries.length, 1);
  assert.equal(audit.entries[0].action, 'bokun_payment_status_conflict');
  assert.deepEqual(audit.entries[0].before, audit.entries[0].after);
});

test('an unaudited lock cannot silently bypass supplier authority', () => {
  const booking = { ...bookingFixture(), bookingPaymentStatus: 'UNPAID', bookingPaymentStatusSource: 'MANUAL_OVERRIDE',
    bookingPaymentOverride: { locked: true } };
  assert.equal(proposeBokunPayment({ booking, payload: paid }).patch.bookingPaymentStatus, 'PAID');
});

test('matching supplier evidence resolves a previous locked conflict with an audit', async () => {
  const booking = { ...bookingFixture(), bookingPaymentStatus: 'PAID', bookingPaymentStatusSource: 'MANUAL_OVERRIDE',
    bookingPaymentOverride: { locked: true, auditReference: 'approved-1' },
    bookingPaymentConflict: { evidenceHash: 'old-conflicting-evidence', proposedStatus: 'UNPAID' } };
  const audit = recorder();
  await syncBokunPayment({ booking, payload: paid, AuditLogModel: audit });
  assert.equal(booking.bookingPaymentConflict, null);
  assert.equal(booking.bookingPaymentStatusSource, 'MANUAL_OVERRIDE');
  assert.equal(audit.entries[0].action, 'bokun_payment_conflict_resolved');
  assert.deepEqual(audit.entries[0].before, audit.entries[0].after);
  await syncBokunPayment({ booking, payload: paid, AuditLogModel: audit });
  assert.equal(audit.entries.length, 1);
});

test('locked override compare-and-set guards the approved status and audit reference', async () => {
  let actualFilter;
  class Booking {
    static modelName = 'Booking';
    static async findOneAndUpdate(filter) { actualFilter = filter; return null; }
  }
  const booking = Object.assign(new Booking(), bookingFixture(), { bookingPaymentStatus: 'UNPAID',
    bookingPaymentStatusSource: 'MANUAL_OVERRIDE', bookingPaymentOverride: { locked: true, auditReference: 'approved-2' } });
  await syncBokunPayment({ booking, payload: paid, AuditLogModel: recorder() });
  assert.equal(actualFilter.bookingPaymentStatusSource, 'MANUAL_OVERRIDE');
  assert.equal(actualFilter.bookingPaymentStatus, 'UNPAID');
  assert.equal(actualFilter['bookingPaymentOverride.auditReference'], 'approved-2');
});

test('an audit outage keeps a retryable event and recovery writes it exactly once', async () => {
  const booking = bookingFixture();
  const audit = recorder();
  await assert.rejects(syncBokunPayment({ booking, payload: paid,
    AuditLogModel: { create: async () => { throw new Error('audit unavailable'); } }
  }), /audit unavailable/);
  const pendingId = booking.bookingPaymentPendingAudit.metadata.bookingPaymentEventId;
  assert.equal(booking.bookingPaymentStatus, 'PAID');
  await syncBokunPayment({ booking, payload: paid, AuditLogModel: audit });
  await syncBokunPayment({ booking, payload: paid, AuditLogModel: audit });
  assert.equal(audit.entries.length, 1);
  assert.equal(audit.entries[0].metadata.bookingPaymentEventId, pendingId);
  assert.equal(booking.bookingPaymentPendingAudit, null);
});

test('a previously committed pending audit duplicate is treated as durable success', async () => {
  const booking = bookingFixture();
  await assert.rejects(syncBokunPayment({ booking, payload: paid,
    AuditLogModel: { create: async () => { throw new Error('connection lost after commit'); } }
  }));
  let attempts = 0;
  await syncBokunPayment({ booking, payload: paid, AuditLogModel: { create: async () => {
    attempts += 1; throw Object.assign(new Error('duplicate event'), { code: 11000 });
  } } });
  assert.equal(attempts, 1);
  assert.equal(booking.bookingPaymentPendingAudit, null);
});

test('a compare-and-set loser does not mutate the document or write a transition audit', async () => {
  class Booking {
    static modelName = 'Booking';
    static filters = [];
    static async findOneAndUpdate(filter) { this.filters.push(filter); return null; }
  }
  const booking = Object.assign(new Booking(), bookingFixture());
  const before = structuredClone({ ...booking });
  const audit = recorder();
  const result = await syncBokunPayment({ booking, payload: paid, AuditLogModel: audit });
  assert.equal(result.skipped, true);
  assert.equal(result.changed, false);
  assert.equal(audit.entries.length, 0);
  assert.deepEqual({ ...booking }, before);
  assert.equal(Booking.filters[0].bookingPaymentPendingAudit, null);
  assert.deepEqual(Booking.filters[0]['bookingPaymentOverride.locked'], { $ne: true });
});
