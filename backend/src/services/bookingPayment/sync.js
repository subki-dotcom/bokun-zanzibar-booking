const crypto = require('crypto');
const AuditLog = require('../../models/AuditLog');
const { mapBokunPaymentStatus } = require('../../integrations/bokun/bookingPayment.mapper');

const paymentIdentity = booking => ({
  status: booking.bookingPaymentStatus || 'UNKNOWN',
  source: booking.bookingPaymentStatusSource || '',
  reportedPaidAmount: booking.bookingPaymentReportedAmount == null ? null : String(booking.bookingPaymentReportedAmount),
  currency: booking.bookingPaymentCurrency || ''
});
const proposeBokunPayment = ({ booking, payload, now = new Date() }) => {
  const mapped = mapBokunPaymentStatus(payload);
  const hash = crypto.createHash('sha256').update(JSON.stringify(mapped)).digest('hex');
  const locked = booking.bookingPaymentStatusSource === 'MANUAL_OVERRIDE' && booking.bookingPaymentOverride?.locked && booking.bookingPaymentOverride?.auditReference;
  const before = paymentIdentity(booking);
  if (locked) {
    const conflict = before.status !== mapped.status;
    return { mapped, hash, before, changed: false, conflict, conflictChanged: conflict ? booking.bookingPaymentConflict?.evidenceHash !== hash : Boolean(booking.bookingPaymentConflict),
      patch: conflict ? { bookingPaymentConflict: { code: 'PAYMENT_STATUS_CONFLICT', proposedStatus: mapped.status, evidenceHash: hash, detectedAt: now, source: 'BOKUN' } } : booking.bookingPaymentConflict ? { bookingPaymentConflict: null } : {} };
  }
  return { mapped, hash, before, conflict: false,
    changed: booking.bookingPaymentEvidenceHash !== hash || before.source !== 'BOKUN',
    patch: {
      bookingPaymentStatus: mapped.status,
      bookingPaymentStatusSource: 'BOKUN',
      bookingPaymentReportedAmount: mapped.reportedPaidAmount == null ? null : String(mapped.reportedPaidAmount),
      bookingPaymentCurrency: mapped.currency || '',
      bookingPaymentStatusSyncedAt: now,
      bookingPaymentEvidenceHash: hash,
      bokunPaymentSnapshot: mapped.evidence,
      bookingPaymentConflict: null
    }
  };
};

// This service only writes explicitly Bókun-owned identity/evidence fields.
// No Payment, Refund, Invoice, settlement or journal services are called here.
const syncBokunPayment = async ({ booking, payload, source = 'sync', requestId = '', now = new Date(), AuditLogModel = AuditLog }) => {
  const Model = booking.constructor?.modelName ? booking.constructor : null;
  const flushAudit = async () => {
    const pending = booking.bookingPaymentPendingAudit;
    if (!pending) return;
    try { await AuditLogModel.create(pending); } catch (error) { if (error.code !== 11000) throw error; }
    if (Model) await Model.updateOne({ _id: booking._id, 'bookingPaymentPendingAudit.metadata.bookingPaymentEventId': pending.metadata.bookingPaymentEventId }, { $set: { bookingPaymentPendingAudit: null } });
    booking.bookingPaymentPendingAudit = null;
    if (!Model && typeof booking.save === "function") await booking.save();
  };
  await flushAudit();
  const proposal = proposeBokunPayment({ booking, payload, now });
  if (proposal.conflict && !proposal.conflictChanged) return proposal;
  if (!Object.keys(proposal.patch).length) return proposal;
  let audit = null;
  if (proposal.changed || proposal.conflictChanged) {
    audit = {
      actorId: null, actorRole: 'system',
      action: proposal.conflict ? 'bokun_payment_status_conflict' : proposal.conflictChanged ? 'bokun_payment_conflict_resolved' : 'bokun_payment_status_synchronized',
      entityType: 'Booking', entityId: String(booking._id), reference: booking.bookingReference || '',
      reason: proposal.conflict ? 'Audited locked manual override requires review' : 'Bokun authoritative customer payment evidence',
      requestId, before: proposal.before, after: proposal.changed ? paymentIdentity(proposal.patch) : proposal.before,
      metadata: { bookingPaymentEventId: crypto.randomUUID(), source: 'BOKUN', syncMethod: source, bokunBookingId: booking.bokunBookingId || '', syncedAt: now, evidenceHash: proposal.hash, evidence: proposal.mapped.evidence }
    };
    proposal.patch.bookingPaymentPendingAudit = audit;
  }
  if (Model) {
    // Optimistic compare-and-set prevents simultaneous webhook/poller updates
    // from producing duplicate transitions or overwriting a newly locked override.
    const filter = { _id: booking._id,
      bookingPaymentEvidenceHash: booking.bookingPaymentEvidenceHash || { $in: ['', null] },
      'bookingPaymentOverride.locked': booking.bookingPaymentOverride?.locked ? true : { $ne: true },
      bookingPaymentPendingAudit: null };
    if (booking.bookingPaymentStatusSource === 'MANUAL_OVERRIDE') {
      filter.bookingPaymentStatusSource = 'MANUAL_OVERRIDE';
      filter.bookingPaymentStatus = booking.bookingPaymentStatus;
      filter['bookingPaymentOverride.auditReference'] = booking.bookingPaymentOverride?.auditReference || { $in: ['', null] };
    }
    if (proposal.conflict) filter['bookingPaymentConflict.evidenceHash'] = booking.bookingPaymentConflict?.evidenceHash || { $in: ['', null] };
    const updated = await Model.findOneAndUpdate(filter, { $set: proposal.patch }, { new: true });
    if (!updated) return { ...proposal, changed: false, skipped: true, reason: 'concurrent_payment_sync' };
    Object.assign(booking, proposal.patch);
    await flushAudit();
    for (const key of [...Object.keys(proposal.patch), 'bookingPaymentPendingAudit']) booking.unmarkModified?.(key);
  } else {
    Object.assign(booking, proposal.patch);
    if (typeof booking.save === 'function') await booking.save();
    await flushAudit();
  }
  return proposal;
};
module.exports = { paymentIdentity, proposeBokunPayment, syncBokunPayment };
