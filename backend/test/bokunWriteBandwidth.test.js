const test = require('node:test');
const assert = require('node:assert/strict');
const Booking = require('../src/models/Booking');
const { applyChangedFields } = require('../src/utils/applyChangedFields');

test('import heartbeat preserves the resulting document without resending unchanged raw evidence', () => {
  const raw = { invoice: 'x'.repeat(200000), payments: [{ amount: 100 }] };
  const initial = new Booking({ bookingReference: 'BANDWIDTH-TEST', rawBokunResponse: raw,
    bokunFinancialEvidence: { raw, status: 'VERIFIED', syncedAt: new Date('2026-10-01') } }).toObject();
  const before = Booking.hydrate(initial);
  const optimized = Booking.hydrate(initial);
  const patch = { rawBokunResponse: structuredClone(raw), bokunFinancialEvidence: {
    ...before.bokunFinancialEvidence.toObject(), syncedAt: new Date('2026-10-03')
  } };
  Object.assign(before, patch);
  applyChangedFields(optimized, patch);
  assert.deepEqual(optimized.toObject(), before.toObject());
  const update = optimized.getChanges();
  assert.ok(update.$set['bokunFinancialEvidence.syncedAt']);
  assert.ok(!JSON.stringify(update).includes('xxxx'));
  assert.ok(Buffer.byteLength(JSON.stringify(update)) < 1000);
  assert.ok(Buffer.byteLength(JSON.stringify(before.getChanges())) > 200000);
});

test('partial nested replacements, removals and casting match the previous setter behavior', () => {
  for (const evidence of [{ currency: 'eur' }, {}, null]) {
    const initial = new Booking({ bookingReference: 'BANDWIDTH-PARTIAL',
      bokunFinancialEvidence: { currency: 'USD', raw: { old: true }, status: 'VERIFIED' }
    }).toObject();
    const expected = Booking.hydrate(initial);
    const actual = Booking.hydrate(initial);
    const patch = { bokunFinancialEvidence: evidence };
    Object.assign(expected, patch);
    applyChangedFields(actual, patch);
    assert.deepEqual(actual.toObject(), expected.toObject());
  }
});

test('an identical patch produces no database update and preserves unrelated pending edits', () => {
  const initial = new Booking({ bookingReference: 'BANDWIDTH-NOOP', rawBokunResponse: { stable: true } }).toObject();
  const booking = Booking.hydrate(initial);
  applyChangedFields(booking, { rawBokunResponse: { stable: true } });
  assert.deepEqual(booking.getChanges(), {});
  booking.productTitle = 'A real pending change';
  applyChangedFields(booking, { rawBokunResponse: { stable: true } });
  assert.equal(booking.getChanges().$set.productTitle, 'A real pending change');
});

test('changed raw evidence, nulls and arrays are still persisted', () => {
  const initial = new Booking({ bookingReference: 'BANDWIDTH-CHANGE', rawBokunResponse: { old: true },
    bokunFinancialEvidence: { raw: { old: true }, invoiceEvidence: [1, 2] } }).toObject();
  const expected = Booking.hydrate(initial);
  const actual = Booking.hydrate(initial);
  const patch = { rawBokunResponse: { new: true }, bokunFinancialEvidence: {
    ...expected.bokunFinancialEvidence.toObject(), raw: null, invoiceEvidence: [3]
  } };
  Object.assign(expected, patch);
  applyChangedFields(actual, patch);
  assert.deepEqual(actual.toObject(), expected.toObject());
  assert.deepEqual(actual.getChanges().$set.rawBokunResponse, { new: true });
  assert.equal(actual.getChanges().$set['bokunFinancialEvidence.raw'], null);
  assert.deepEqual(actual.getChanges().$set['bokunFinancialEvidence.invoiceEvidence'], [3]);
});
