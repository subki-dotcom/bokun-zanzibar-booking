const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const crypto = require('crypto');
const BookingSchema = require('../src/models/Booking').schema;
const AuditSchema = require('../src/models/AuditLog').schema;
const { syncBokunPayment } = require('../src/services/bookingPayment/sync');

test('isolated Mongo: concurrent sync, durable pending audit retry and locked override races', {
  skip: !process.env.BOOKING_PAYMENT_TEST_MONGO_URI
}, async () => {
  // Deliberately never use MONGO_URI or the application database name.
  const database = `booking_payment_test_${process.pid}_${crypto.randomBytes(8).toString('hex')}`;
  const connection = await mongoose.createConnection(process.env.BOOKING_PAYMENT_TEST_MONGO_URI, {
    dbName: database, serverSelectionTimeoutMS: 5000
  }).asPromise();
  try {
    assert.equal(connection.name, database);
    const Booking = connection.model('Booking', BookingSchema);
    const Audit = connection.model('AuditLog', AuditSchema);
    await Promise.all([Booking.init(), Audit.init()]);
    const created = await Booking.create({ bookingReference: 'ISOLATED-1', bokunProductId: 'p1', bokunOptionId: 'o1',
      productTitle: 'Fixture', optionTitle: 'Fixture', travelDate: '2026-09-09', amount: 100, amountPaid: 0,
      amountRefunded: 0, currency: 'USD', paymentStatus: 'pending' });
    const paid = { totalPrice: 100, totalPaid: 100, paymentType: 'PAID_IN_FULL', currency: 'USD' };
    const original = await Booking.findById(created._id).lean();
    const copies = await Promise.all(Array.from({ length: 6 }, () => Booking.findById(created._id)));
    const outcomes = await Promise.all(copies.map(booking => syncBokunPayment({ booking, payload: paid, AuditLogModel: Audit })));
    assert.equal(outcomes.filter(result => result.changed).length, 1);
    assert.equal(await Audit.countDocuments({ entityId: String(created._id) }), 1);
    let saved = await Booking.findById(created._id).lean();
    assert.equal(saved.bookingPaymentStatus, 'PAID');
    assert.equal(saved.bookingPaymentReportedAmount.toString(), '100');
    assert.equal(saved.bookingPaymentPendingAudit, null);
    for (const field of ['amount', 'amountPaid', 'amountRefunded', 'paymentStatus', 'currency', 'pricingSnapshot']) {
      assert.deepEqual(saved[field], original[field], `financial field ${field} stays unchanged`);
    }
    for (const collection of ['payments', 'refunds', 'invoices', 'journalentries']) {
      assert.equal(await connection.db.collection(collection).countDocuments(), 0);
    }

    const refund = { paymentStatus: 'REFUNDED', totalPaid: 100, currency: 'USD' };
    await assert.rejects(syncBokunPayment({ booking: await Booking.findById(created._id), payload: refund,
      AuditLogModel: { create: async () => { throw new Error('audit store temporarily unavailable'); } }
    }), /temporarily unavailable/);
    saved = await Booking.findById(created._id).lean();
    assert.equal(saved.bookingPaymentStatus, 'REFUNDED');
    assert.ok(saved.bookingPaymentPendingAudit.metadata.bookingPaymentEventId);
    const eventId = saved.bookingPaymentPendingAudit.metadata.bookingPaymentEventId;
    // Concurrent recovery attempts exercise the real unique audit event index.
    const retries = await Promise.all([Booking.findById(created._id), Booking.findById(created._id)]);
    await Promise.all(retries.map(booking => syncBokunPayment({ booking, payload: refund, AuditLogModel: Audit })));
    assert.equal(await Audit.countDocuments({ 'metadata.bookingPaymentEventId': eventId }), 1);
    assert.equal(await Audit.countDocuments({ entityId: String(created._id) }), 2);
    assert.equal((await Booking.findById(created._id).lean()).bookingPaymentPendingAudit, null);

    await Booking.updateOne({ _id: created._id }, { $set: { bookingPaymentStatus: 'UNPAID',
      bookingPaymentStatusSource: 'MANUAL_OVERRIDE', bookingPaymentOverride: { locked: true, auditReference: 'old-approval' } } });
    const stale = await Booking.findById(created._id);
    await Booking.updateOne({ _id: created._id }, { $set: { bookingPaymentStatus: 'PARTIALLY_PAID',
      'bookingPaymentOverride.auditReference': 'new-approval' } });
    const raced = await syncBokunPayment({ booking: stale, payload: paid, AuditLogModel: Audit });
    assert.equal(raced.skipped, true);
    saved = await Booking.findById(created._id).lean();
    assert.equal(saved.bookingPaymentStatus, 'PARTIALLY_PAID');
    assert.equal(saved.bookingPaymentOverride.auditReference, 'new-approval');
    assert.equal(await Audit.countDocuments({ entityId: String(created._id) }), 2);
  } finally {
    if (connection.name !== database || !/^booking_payment_test_\d+_[a-f0-9]{16}$/.test(database)) {
      await connection.close();
      throw new Error('Refusing cleanup of an unowned database');
    }
    await connection.dropDatabase();
    await connection.close();
  }
});
