import test from 'node:test';
import assert from 'node:assert/strict';
import { getPurchaseProjection, isBackendPaymentVerified } from '../src/utils/purchaseProjection.js';

const purchase = { transaction_id: 'RB-123', value: 100, currency: 'USD', items: [{ item_id: '42', item_name: 'Spice tour' }] };

test('purchase projection waits for backend paid status, not supplier confirmation', () => {
  assert.equal(isBackendPaymentVerified({ paymentStatus: 'pending' }), false);
  assert.equal(getPurchaseProjection({ paymentStatus: 'pending', analyticsPurchase: purchase }), null);
  assert.equal(isBackendPaymentVerified({ paymentStatus: 'paid', bookingStatus: 'pending' }), true);
  assert.deepEqual(getPurchaseProjection({ paymentStatus: 'paid', bookingStatus: 'pending', analyticsPurchase: purchase }), purchase);
});

test('purchase projection is required from the backend payment response', () => {
  assert.equal(getPurchaseProjection({ paymentStatus: 'paid' }), null);
  assert.equal(getPurchaseProjection({ paymentStatus: 'failed', analyticsPurchase: purchase }), null);
});