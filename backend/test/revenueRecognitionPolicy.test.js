const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRevenue, activationBlockers } = require('../src/services/revenueRecognition/policy');

const fixture = (channel = 'DIRECT_WEBSITE') => ({
  booking: {
    _id: 'b1',
    bookingReference: 'R1',
    customer: { customerId: 'customer1' },
    bokunProductId: 'tour1',
    bookingStatus: 'confirmed',
    salesChannel: channel,
    createdAt: '2026-09-21T10:00:00Z',
    pricingSnapshot: { finalPayable: 100, currency: 'USD' },
  },
  completion: {
    _id: 'c1',
    bookingId: 'b1',
    bookingReference: 'R1',
    serviceKey: 'tour1',
    status: 'COMPLETED',
    evidenceSource: 'GUIDE_CONFIRMATION',
    createdBy: 'guide1',
    externalReference: 'manifest-1',
    verifiedAt: '2026-09-21T12:00:00Z',
    completedAt: '2026-09-21T12:00:00Z',
    createdAt: '2026-09-21T12:00:00Z',
  },
  now: new Date('2026-09-21T13:00:00Z'),
  baseCurrency: 'USD',
});
test('verified direct completion is eligible unpaid; booking.amount is never a fallback', () => {
  const f = fixture();
  assert.equal(evaluateRevenue(f).status, 'READY');
  assert.equal(evaluateRevenue(f).debtor.type, 'CUSTOMER');
  delete f.booking.pricingSnapshot;
  f.booking.amount = 100;
  assert.equal(evaluateRevenue(f).status, 'NEEDS_REVIEW');
});
test('paid and past travel date never replace completion', () => {
  const f = fixture();
  f.booking.paymentStatus = 'paid';
  f.booking.travelDate = '2020-01-01';
  f.completion.status = 'SCHEDULED';
  assert.equal(evaluateRevenue(f).eligible, false);
});
test('GYG recognizes 14.96 supplier net without another commission deduction', () => {
  const f = fixture('GETYOURGUIDE');
  f.booking.bokunFinancialEvidence = {
    source: 'BOKUN',
    status: 'VERIFIED',
    grossAmount: 22,
    otaCommissionAmount: 7.04,
    expectedSellerInvoiceAmount: 14.96,
    expectedSellerInvoiceCurrency: 'USD',
    evidenceHash: 'verified-invoice',
  };
  const result = evaluateRevenue(f);
  assert.equal(result.originalAmount, '14.96');
  assert.equal(result.usdAmount, '14.96');
  assert.equal(result.debtor.mappingKey, 'GYG_RECEIVABLE');
  assert.equal(result.commissionExpense, '0');
});
test('Viator verified supplier 115.60 is eligible without cash or commission percentage', () => {
  const f = fixture('VIATOR');
  f.booking.bokunFinancialEvidence = {
    source: 'BOKUN',
    status: 'VERIFIED',
    sellerInvoiceEvidence: { sellerInvoiceTotal: '115.60', currency: 'USD', invoiceId: 'V1' },
  };
  const result = evaluateRevenue(f);
  assert.equal(result.status, 'READY');
  assert.equal(result.usdAmount, '115.60');
  assert.equal(result.debtor.id, 'VIATOR');
  delete f.booking.bokunFinancialEvidence.sellerInvoiceEvidence;
  f.booking.bokunFinancialEvidence.grossAmount = 150;
  assert.equal(evaluateRevenue(f).status, 'NEEDS_REVIEW');
});
test('completion contradictions and wrong booking are blocked', () => {
  for (const change of [
    { evidenceSource: 'BOKUN_NO_SHOW' },
    { externalStatus: 'NO_SHOW' },
    { bookingId: 'wrong' },
    { completedAt: null },
  ]) {
    const f = fixture();
    Object.assign(f.completion, change);
    assert.equal(evaluateRevenue(f).eligible, false);
  }
});
test('EUR recognition requires verified completion-date FX and preserves evidence', () => {
  const f = fixture();
  f.booking.pricingSnapshot.currency = 'EUR';
  assert.equal(evaluateRevenue(f).status, 'NEEDS_REVIEW_FX');
  f.completion.revenueEvidence = {
    status: 'VERIFIED',
    verifiedBy: 'accountant',
    verifiedAt: f.now,
    reference: 'FX1',
    fx: {
      rate: '1.18',
      source: 'approved-bank',
      date: '2026-09-21',
      fromCurrency: 'EUR',
      toCurrency: 'USD',
    },
  };
  assert.equal(evaluateRevenue(f).usdAmount, '118.00');
  f.completion.revenueEvidence.fx.date = '2026-09-20';
  assert.equal(evaluateRevenue(f).status, 'NEEDS_REVIEW_FX');
});
test('cancelled, no-show, refund and review states block normal recognition', () => {
  for (const status of [
    'cancelled',
    'NO_SHOW',
    'REFUNDED',
    'PARTIALLY_REFUNDED',
    'NEEDS_REVIEW',
    'NEEDS_POLICY',
  ]) {
    const f = fixture();
    f.booking.bookingStatus = status;
    assert.equal(evaluateRevenue(f).eligible, false);
  }
});
test('zero is verified zero; missing amount remains unknown', () => {
  const f = fixture();
  f.booking.pricingSnapshot.finalPayable = 0;
  assert.equal(evaluateRevenue(f).status, 'ZERO_REVENUE');
  f.booking.pricingSnapshot.finalPayable = null;
  assert.equal(evaluateRevenue(f).originalAmount, null);
});
test('component recognition requires a verified full allocation plan', () => {
  const f = fixture();
  f.booking.rawBokunResponse = { activityBookings: [{ id: 'one' }, { id: 'two' }] };
  f.completion.serviceKey = 'one';
  assert.equal(evaluateRevenue(f).eligible, false);
  f.completion.revenueEvidence = {
    status: 'VERIFIED',
    verifiedBy: 'accountant',
    verifiedAt: f.now,
    reference: 'allocation1',
    components: [
      { serviceKey: 'one', amount: '30' },
      { serviceKey: 'two', amount: '70' },
    ],
  };
  const result = evaluateRevenue(f);
  assert.equal(result.status, 'READY');
  assert.equal(result.originalAmount, '30');
});
module.exports = { fixture };

test('direct receivable requires customer identity evidence', () => {
  const f = fixture();
  delete f.booking.customer;
  assert.ok(evaluateRevenue(f).blockers.includes('RECEIVABLE_PARTY_REQUIRED'));
});

test('stored OTA refund and raw no-show evidence override clean local flags', () => {
  for (const fields of [
    { bokunFinancialEvidence: { paymentStatus: 'PARTIALLY_REFUNDED' } },
    { bokunStatus: { normalized: 'confirmed', raw: 'NO_SHOW' } },
    { cancellation: { cancelledAt: '2026-09-21' } },
  ]) {
    const f = fixture();
    Object.assign(f.booking, fields);
    assert.equal(evaluateRevenue(f).eligible, false);
  }
});
test('activation accepts only new verified completion events strictly after the UTC boundary', () => {
  const f = fixture();
  const config = {
    REVENUE_RECOGNITION_ACTIVATED_AT: '2026-09-21T11:00:00Z',
    REVENUE_RECOGNITION_ACTIVATION_SCOPE: 'NEW_COMPLETIONS',
  };
  assert.deepEqual(activationBlockers({ config, ...f, now: f.now }), []);
  f.booking.createdAt = '2020-01-01T00:00:00Z';
  assert.deepEqual(activationBlockers({ config, ...f, now: f.now }), []);
  f.completion.completedAt = '2026-09-21T11:00:00Z';
  assert.deepEqual(activationBlockers({ config, ...f, now: f.now }), ['OUTSIDE_ACTIVATION_BOUNDARY']);
  f.completion.completedAt = '2026-09-21T10:59:59Z';
  assert.deepEqual(activationBlockers({ config, ...f, now: f.now }), ['OUTSIDE_ACTIVATION_BOUNDARY']);
});
