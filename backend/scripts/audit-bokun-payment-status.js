require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const Booking = require('../src/models/Booking');
const Invoice = require('../src/models/Invoice');
const bokun = require('../src/services/bokun');
const { presentBookingPayment } = require('../src/services/bookingPayment/view');
const { loadSettlementViews } = require('../src/services/bookingPayment/settlementView');
const { proposeBokunPayment, syncBokunPayment } = require('../src/services/bookingPayment/sync');
const { mapBokunPaymentStatus } = require('../src/integrations/bokun/bookingPayment.mapper');
const args = process.argv.slice(2);
const arg = (name, fallback = '') => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;

async function main() {
  const apply = args.includes('--apply');
  const auditOnly = args.includes('--audit');
  if (apply && !arg('--review')) throw new Error('--apply requires --review <previous dry-run JSON report> after human review.');
  const reviewed = apply ? JSON.parse(fs.readFileSync(arg('--review'), 'utf8')) : null;
  if (apply && reviewed.mode !== 'dry-run') throw new Error('Review file must be a dry-run report.');
  const reviewedRows = new Map((reviewed?.rows || []).map(row => [row.bookingId, row]));
  const limit = Math.max(1, Math.min(500, Number(arg('--limit', '100'))));
  const query = { $or: [{ bokunBookingId: { $type: 'string', $ne: '' } }, { operationalSource: 'BOKUN' }] };
  if (arg('--reference')) query.bookingReference = arg('--reference');
  if (arg('--after')) query._id = { $gt: new mongoose.Types.ObjectId(arg('--after')) };
  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const total = await Booking.countDocuments(query);
  const bookings = await Booking.find(query).sort({ _id: 1 }).limit(limit);
  const references = bookings.map(booking => booking.bookingReference);
  const invoices = await Invoice.find({ bookingReference: { $in: references } }).select('bookingReference paymentStatus').lean();
  const settlements = await loadSettlementViews(references);
  const rows = [];
  for (const booking of bookings) {
    const row = { bookingId: String(booking._id), bokunBookingId: booking.bokunBookingId, channel: booking.salesChannel,
      oldStatus: booking.bookingPaymentStatus || 'UNKNOWN', legacyBookingStatus: booking.paymentStatus,
      invoicePaymentStatus: invoices.find(invoice => invoice.bookingReference === booking.bookingReference)?.paymentStatus || null,
      settlementStatus: settlements.get(booking.bookingReference)?.status,
      settlementImpact: 'NONE', oldEvidenceHash: booking.bookingPaymentEvidenceHash || '', conflict: null };
    if (auditOnly) {
      row.bokunStatus = booking.rawBokunResponse ? mapBokunPaymentStatus(booking.rawBokunResponse).status : 'UNKNOWN';
      row.evidenceSource = 'STORED_SUPPLIER_SNAPSHOT';
      row.currentDisplay = presentBookingPayment(booking).status;
    } else {
      try {
        if (!booking.bokunBookingId && !booking.bokunConfirmationCode) throw new Error('No supplier identifier');
        const payload = await bokun.lookupBooking(booking.bokunBookingId || booking.bokunConfirmationCode, 'payment-status-backfill-read');
        const proposal = proposeBokunPayment({ booking, payload });
        Object.assign(row, { bokunStatus: proposal.mapped.status, proposedStatus: proposal.mapped.status, evidenceHash: proposal.hash,
          invoiceDisplayImpact: `${row.oldStatus} → ${proposal.mapped.status}; local invoice accounting unchanged`,
          evidenceSource: 'LIVE_BOKUN_LOOKUP', conflict: proposal.conflict ? 'PAYMENT_STATUS_CONFLICT' : proposal.mapped.status === 'UNKNOWN' ? 'UNKNOWN_REQUIRES_REVIEW' : null });
        if (apply) {
          const prior = reviewedRows.get(row.bookingId);
          if (!prior || prior.conflict || row.conflict || prior.evidenceHash !== row.evidenceHash || prior.oldEvidenceHash !== row.oldEvidenceHash) row.conflict = 'REVIEW_CHANGED_OR_MISSING';
          else {
            const result = await syncBokunPayment({ booking, payload, source: 'reviewed_backfill', requestId: 'reviewed-payment-status-backfill' });
            row.applied = !result.skipped && !result.conflict;
          }
        }
      } catch (error) { row.conflict = 'LOOKUP_OR_APPLY_FAILED'; row.error = error.code || error.message; }
    }
    rows.push(row);
  }
  const report = { mode: auditOnly ? 'audit' : apply ? 'apply' : 'dry-run', generatedAt: new Date().toISOString(), totalMatching: total,
    scanned: rows.length, truncated: total > rows.length, nextAfter: bookings.at(-1)?._id?.toString(),
    accountingWrites: false, rows };
  if (arg('--output')) fs.writeFileSync(arg('--output'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode: report.mode, totalMatching: total, scanned: rows.length, conflicts: rows.filter(row => row.conflict).length, output: arg('--output') || null }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
