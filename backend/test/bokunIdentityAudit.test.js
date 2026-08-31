const test = require('node:test');
const assert = require('node:assert/strict');

const { auditBookings } = require('../src/scripts/bokunIdentityAudit');
const { findDuplicateKeys } = require('../src/scripts/bokunIdentityMigrate');

test('classifies exact duplicates by bokunBookingId', async () => {
  const docs = [
    { _id: '1', bookingReference: 'BR-1', bokunBookingId: 'B1', bokunProductId: 'P1', travelDate: '2026-11-01', amount: 100 },
    { _id: '2', bookingReference: 'BR-2', bokunBookingId: 'B1', bokunProductId: 'P1', travelDate: '2026-11-01', amount: 100 }
  ];

  const BookingModel = {
    find: () => ({ cursor: async function* () { for (const d of docs) yield d; } })
  };

  const PaymentModel = { countDocuments: async () => 0 };
  const InvoiceModel = { countDocuments: async () => 0 };
  const RefundModel = { countDocuments: async () => 0 };

  const report = await auditBookings({ BookingModel, PaymentModel, InvoiceModel, RefundModel });
  assert.equal(report.groups.bokunBookingId.length, 1);
  const res = report.groups.bokunBookingId[0].result;
  assert.equal(res.classification, 'EXACT_DUPLICATE');
  assert.equal(res.count, 2);
});

test('marks highRisk when payments or invoices exist', async () => {
  const docs = [
    { _id: '3', bookingReference: 'BR-3', bokunBookingId: 'B2', bokunProductId: 'P2', travelDate: '2026-12-01', amount: 50 },
    { _id: '4', bookingReference: 'BR-4', bokunBookingId: 'B2', bokunProductId: 'P2', travelDate: '2026-12-02', amount: 60 }
  ];

  const BookingModel = {
    find: () => ({ cursor: async function* () { for (const d of docs) yield d; } })
  };

  const PaymentModel = { countDocuments: async (q) => q && q.bookingReference && q.bookingReference.$in && q.bookingReference.$in.includes('BR-3') ? 1 : 0 };
  const InvoiceModel = { countDocuments: async () => 0 };
  const RefundModel = { countDocuments: async () => 0 };

  const report = await auditBookings({ BookingModel, PaymentModel, InvoiceModel, RefundModel });
  assert.equal(report.groups.bokunBookingId.length, 1);
  const res = report.groups.bokunBookingId[0].result;
  assert.equal(res.highRisk, true);
});

test('detects duplicates for confirmation code groups', async () => {
  const docs = [
    { _id: '5', bookingReference: 'BR-5', bokunConfirmationCode: 'C1', bokunProductId: 'P3', travelDate: '2026-11-05', amount: 200 },
    { _id: '6', bookingReference: 'BR-6', bokunConfirmationCode: 'C1', bokunProductId: 'P3', travelDate: '2026-11-05', amount: 200 }
  ];

  const BookingModel = {
    find: () => ({ cursor: async function* () { for (const d of docs) yield d; } })
  };

  const PaymentModel = { countDocuments: async () => 0 };
  const InvoiceModel = { countDocuments: async () => 0 };
  const RefundModel = { countDocuments: async () => 0 };

  const report = await auditBookings({ BookingModel, PaymentModel, InvoiceModel, RefundModel });
  assert.equal(report.groups.confirmationCode.length, 1);
  const res = report.groups.confirmationCode[0].result;
  assert.equal(res.classification, 'EXACT_DUPLICATE');
});

test('findDuplicateKeys returns aggregated duplicate keys', async () => {
  const BookingModel = {
    aggregate: async (pipeline) => {
      return [{ _id: 'DUP1', count: 2, ids: ['1','2'] }];
    }
  };

  const res = await findDuplicateKeys({ BookingModel, key: 'bokunBookingId' });
  assert.equal(Array.isArray(res), true);
  assert.equal(res.length, 1);
  assert.equal(res[0]._id, 'DUP1');
});
