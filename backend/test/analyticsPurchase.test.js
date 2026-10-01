const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPurchaseAnalytics } = require('../src/services/bookings/analytics');
const booking = { bookingReference: 'RB-123', bokunBookingId: 'supplier-1', bokunProductId: '42', productTitle: 'Spice tour',
  sourceChannel: 'direct_website', createdByRole: 'customer', bookingStatus: 'confirmed', paymentStatus: 'paid',
  pendingCheckout: { paymentProvider: 'pesapal', paymentVerifiedAt: '2026-09-30T12:00:00Z', paymentTransactionId: 'opaque', paidAmount: 100, paidCurrency: 'USD' },
  customer: { email: 'private@example.com', phone: 'private' }, rawBokunResponse: { secret: 'never-copy' } };
test('verified paid direct website booking yields allowlisted purchase before or after supplier confirmation', () => {
  assert.deepEqual(buildPurchaseAnalytics(booking), { transaction_id:'RB-123',value:100,currency:'USD',
    items:[{item_id:'42',item_name:'Spice tour',item_category:'Tour',price:100,quantity:1}] });
  const supplierPending = {...booking, bookingStatus:'pending', bokunBookingId:''};
  assert.deepEqual(buildPurchaseAnalytics(supplierPending), { transaction_id:'RB-123',value:100,currency:'USD',
    items:[{item_id:'42',item_name:'Spice tour',item_category:'Tour',price:100,quantity:1}] });
  for(const patch of [{paymentStatus:'pending'},{paymentStatus:'failed'},{bookingStatus:'cancelled'},
    {sourceChannel:'VIATOR'},{sourceChannel:'agent_portal'},{sourceChannel:'admin_dashboard'},
    {agentId:'agent'},{createdByRole:'super_admin'},{createdByRole:'payment_recovery'}, {amountRefunded:10}]) {
    assert.equal(buildPurchaseAnalytics({...booking,...patch}),null,JSON.stringify(patch));
  }
});
test('missing evidence, amount/currency and mock/sandbox payments cannot become purchases', () => {
  for(const patch of [{paymentVerifiedAt:''},{paymentTransactionId:''},{paymentTransactionId:'MOCKPESAPAL-1'},
    {paidAmount:NaN},{paidAmount:-1},{paidAmount:'100'},{paidCurrency:''},{paymentProvider:'manual'}]) {
    assert.equal(buildPurchaseAnalytics({...booking,pendingCheckout:{...booking.pendingCheckout,...patch}}),null);
  }
  assert.equal(buildPurchaseAnalytics(booking,{PESAPAL_MOCK_MODE:true}),null);
  assert.equal(buildPurchaseAnalytics(booking,{BOKUN_MOCK_MODE:true}),null);
  assert.equal(buildPurchaseAnalytics(booking,{PESAPAL_BASE_URL:'https://sandbox.example.com'}),null);
});
