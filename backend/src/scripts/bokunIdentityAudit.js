const fs = require('fs');
const path = require('path');
let env = {};
try {
  env = require('../../config/env').env;
} catch (e) {
  // allow tests to require this module without env installed
  env = {};
}

const normalizeKey = (v) => {
  if (v === null || v === undefined) return '';
  return String(v || '').trim();
};

const defaultBatchSize = 500;

async function auditBookings({ BookingModel, PaymentModel, InvoiceModel, RefundModel, batchSize = defaultBatchSize } = {}) {
  if (!BookingModel) {
    try {
      BookingModel = require('../models/Booking');
    } catch (e) {
      BookingModel = require(path.resolve(process.cwd(), 'backend', 'src', 'models', 'Booking'));
    }
  }
  if (!PaymentModel) {
    try {
      PaymentModel = require('../models/Payment');
    } catch (e) {
      PaymentModel = require(path.resolve(process.cwd(), 'backend', 'src', 'models', 'Payment'));
    }
  }
  if (!InvoiceModel) {
    try {
      InvoiceModel = require('../models/Invoice');
    } catch (e) {
      InvoiceModel = require(path.resolve(process.cwd(), 'backend', 'src', 'models', 'Invoice'));
    }
  }
  if (!RefundModel) {
    try {
      RefundModel = require('../models/Refund');
    } catch (e) {
      RefundModel = require(path.resolve(process.cwd(), 'backend', 'src', 'models', 'Refund'));
    }
  }

  const cursor = BookingModel.find({}).cursor();

  const stats = {
    total: 0,
    withBokunId: 0,
    missingBokunId: 0
  };

  const groups = {
    byBokunId: new Map(),
    byConfirmationCode: new Map(),
    byExternalRef: new Map(),
    byBookingReference: new Map()
  };

  for await (const doc of cursor) {
    stats.total += 1;
    const bokunId = normalizeKey(doc.bokunBookingId);
    const conf = normalizeKey(doc.bokunConfirmationCode);
    const ext = normalizeKey(doc.bokunExternalBookingReference);
    const br = normalizeKey(doc.bookingReference);

    if (bokunId) {
      stats.withBokunId += 1;
      if (!groups.byBokunId.has(bokunId)) groups.byBokunId.set(bokunId, []);
      groups.byBokunId.get(bokunId).push(doc);
    } else {
      stats.missingBokunId += 1;
    }

    if (conf) {
      if (!groups.byConfirmationCode.has(conf)) groups.byConfirmationCode.set(conf, []);
      groups.byConfirmationCode.get(conf).push(doc);
    }

    if (ext) {
      if (!groups.byExternalRef.has(ext)) groups.byExternalRef.set(ext, []);
      groups.byExternalRef.get(ext).push(doc);
    }

    if (br) {
      if (!groups.byBookingReference.has(br)) groups.byBookingReference.set(br, []);
      groups.byBookingReference.get(br).push(doc);
    }
  }

  const classifyGroup = async (items) => {
    const sample = items[0];
    const sameProduct = items.every((b) => normalizeKey(b.bokunProductId) === normalizeKey(sample.bokunProductId));
    const sameDate = items.every((b) => normalizeKey(b.travelDate) === normalizeKey(sample.travelDate));
    const sameAmount = items.every((b) => Number(b.amount || 0) === Number(sample.amount || 0));

    let classification = 'AMBIGUOUS';
    if (items.length === 1) classification = 'UNIQUE';
    else if (sameProduct && sameDate && sameAmount) classification = 'EXACT_DUPLICATE';
    else if (sameProduct && (sameDate || sameAmount)) classification = 'LIKELY_DUPLICATE';
    else classification = 'REQUIRES_REVIEW';

    const ids = items.map((b) => (b._id && b._id.toString ? b._id.toString() : String(b._id || '')));
    const bookingRefs = items.map((b) => b.bookingReference || '');
    const payments = await PaymentModel.countDocuments({ bookingReference: { $in: bookingRefs } }).catch(() => 0);
    const invoices = await InvoiceModel.countDocuments({ bookingReference: { $in: bookingRefs } }).catch(() => 0);
    const refunds = await RefundModel.countDocuments({ bookingId: { $in: ids } }).catch(() => 0);

    const highRisk = (payments + invoices + refunds) > 0;

    return {
      classification,
      count: items.length,
      sample: {
        _id: sample._id,
        bookingReference: sample.bookingReference,
        bokunBookingId: sample.bokunBookingId,
        bokunConfirmationCode: sample.bokunConfirmationCode,
        bokunExternalBookingReference: sample.bokunExternalBookingReference,
        product: sample.bokunProductId,
        travelDate: sample.travelDate,
        amount: sample.amount
      },
      payments,
      invoices,
      refunds,
      highRisk
    };
  };

  const report = {
    generatedAt: new Date().toISOString(),
    stats,
    groups: {
      bokunBookingId: [],
      confirmationCode: [],
      externalReference: [],
      bookingReference: []
    }
  };

  for (const [key, items] of groups.byBokunId.entries()) {
    if (items.length <= 1) continue;
    report.groups.bokunBookingId.push({ key, result: await classifyGroup(items) });
  }

  for (const [key, items] of groups.byConfirmationCode.entries()) {
    if (items.length <= 1) continue;
    report.groups.confirmationCode.push({ key, result: await classifyGroup(items) });
  }

  for (const [key, items] of groups.byExternalRef.entries()) {
    if (items.length <= 1) continue;
    report.groups.externalReference.push({ key, result: await classifyGroup(items) });
  }

  for (const [key, items] of groups.byBookingReference.entries()) {
    if (items.length <= 1) continue;
    report.groups.bookingReference.push({ key, result: await classifyGroup(items) });
  }

  return report;
}

async function runAuditCLI({ outDir } = {}) {
  outDir = outDir || path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  let Booking; let Payment; let Invoice; let Refund;
  try {
    Booking = require('../models/Booking');
    Payment = require('../models/Payment');
    Invoice = require('../models/Invoice');
    Refund = require('../models/Refund');
  } catch (e) {
    Booking = require(path.resolve(process.cwd(), 'backend', 'src', 'models', 'Booking'));
    Payment = require(path.resolve(process.cwd(), 'backend', 'src', 'models', 'Payment'));
    Invoice = require(path.resolve(process.cwd(), 'backend', 'src', 'models', 'Invoice'));
    Refund = require(path.resolve(process.cwd(), 'backend', 'src', 'models', 'Refund'));
  }

  const report = await auditBookings({ BookingModel: Booking, PaymentModel: Payment, InvoiceModel: Invoice, RefundModel: Refund });
  const filename = `bokun-booking-identity-audit-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  const filePath = path.join(outDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
  console.log('Audit written to', filePath);
  return { report, filePath };
}

module.exports = {
  auditBookings,
  runAuditCLI
};
