const mongoose = require("mongoose");

const DUPLICATE_CLASSIFICATION = "NEEDS_MANUAL_REVIEW";

const detailProjection = {
  _id: 1, createdAt: 1, updatedAt: 1, status: 1, paymentStatus: 1,
  bookingStatus: 1, salesChannel: 1, sourceChannel: 1, provider: 1,
  amount: 1, currency: 1, transactionCurrency: 1, bookingReference: 1,
  bokunBookingId: 1, bokunConfirmationCode: 1, bokunExternalBookingReference: 1,
  externalChannelReference: 1, invoiceNumber: 1, providerTransactionId: 1,
  orderTrackingId: 1, paypalCaptureId: 1, dpoTransactionToken: 1,
  allocationKey: 1, idempotencyKey: 1, refundReference: 1,
  providerRefundReference: 1, providerRefundRequestReference: 1, postingKey: 1
};

const duplicateGroups = async (collection, identity, match) => collection.aggregate([
  { $match: match },
  { $group: { _id: identity, count: { $sum: 1 }, recordIds: { $push: "$_id" } } },
  { $match: { count: { $gt: 1 } } },
  { $lookup: { from: collection.collectionName, localField: "recordIds", foreignField: "_id", as: "records", pipeline: [{ $project: detailProjection }] } },
  { $project: { _id: 0, identity: "$_id", count: 1, classification: { $literal: DUPLICATE_CLASSIFICATION }, records: 1 } },
  { $sort: { count: -1 } }
]).toArray();

const nonEmptyString = (field) => ({ [field]: { $type: "string", $gt: "" } });

const normalizeChannel = (record = {}) => String(record.salesChannel || record.sourceChannel || "UNKNOWN")
  .trim()
  .toUpperCase() || "UNKNOWN";

const classifySharedExternalChannelReferences = (groups = []) => groups.map((group) => {
  const channels = [...new Set((group.records || []).map(normalizeChannel))].sort();
  const inconsistent = channels.length > 1;
  return {
    ...group,
    classification: inconsistent ? DUPLICATE_CLASSIFICATION : "INFORMATIONAL_SHARED_IDENTIFIER",
    issueCode: inconsistent ? "CHANNEL_REFERENCE_INCONSISTENCY" : "SHARED_EXTERNAL_CHANNEL_IDENTIFIER",
    channels,
    isConflict: inconsistent
  };
});

const buildAuditReport = (groups = {}) => {
  const {
    bookingReferenceDuplicates = [], bokunBookingIdDuplicates = [], bokunExternalReferenceDuplicates = [],
    externalChannelReferenceGroups = [], invoiceDuplicates = [], providerTransactionDuplicates = [],
    providerOrderDuplicates = [], paymentAllocationDuplicates = [], allocationIdempotencyDuplicates = [],
    refundDuplicates = [], refundIdempotencyDuplicates = [], postingKeyDuplicates = [],
    accountingPostingKeyDuplicates = [], accountingIdempotencyDuplicates = [], webhookEventDuplicates = []
  } = groups;
  const sharedExternalChannelReferences = classifySharedExternalChannelReferences(externalChannelReferenceGroups);
  const channelReferenceInconsistencies = sharedExternalChannelReferences.filter((row) => row.isConflict);
  const report = {
    generatedAt: new Date().toISOString(), mode: "READ_ONLY", classificationPolicy: DUPLICATE_CLASSIFICATION,
    bookingReferenceDuplicates, bokunBookingIdDuplicates, bokunExternalReferenceDuplicates,
    externalReferenceDuplicates: bokunExternalReferenceDuplicates,
    sharedExternalChannelReferences, channelReferenceInconsistencies,
    invoiceDuplicates, providerTransactionDuplicates, providerOrderDuplicates,
    webhookEventDuplicates,
    suspiciousPaymentDuplicates: [...providerTransactionDuplicates, ...providerOrderDuplicates],
    paymentAllocationDuplicates, allocationIdempotencyDuplicates,
    refundDuplicates, refundIdempotencyDuplicates, postingKeyDuplicates, accountingPostingKeyDuplicates,
    accountingIdempotencyDuplicates
  };
  report.totalConflictGroups = [
    bookingReferenceDuplicates, bokunBookingIdDuplicates, bokunExternalReferenceDuplicates,
    channelReferenceInconsistencies, invoiceDuplicates, providerTransactionDuplicates,
    providerOrderDuplicates, paymentAllocationDuplicates, allocationIdempotencyDuplicates,
    refundDuplicates, refundIdempotencyDuplicates, postingKeyDuplicates,
    accountingPostingKeyDuplicates, accountingIdempotencyDuplicates, webhookEventDuplicates
  ].reduce((n, rows) => n + rows.length, 0);
  return report;
};

const runDuplicateAudit = async ({ connection = mongoose.connection } = {}) => {
  if (!connection?.db) throw new Error("A MongoDB connection is required for the duplicate audit");
  const c = (name) => connection.db.collection(name);
  const [
    bookingReferenceDuplicates, bokunBookingIdDuplicates, bokunExternalReferenceDuplicates,
    externalChannelReferenceGroups,
    invoiceDuplicates, providerTransactionDuplicates, providerOrderDuplicates,
    paymentAllocationDuplicates, allocationIdempotencyDuplicates,
    refundDuplicates, refundIdempotencyDuplicates, postingKeyDuplicates,
    accountingPostingKeyDuplicates, accountingIdempotencyDuplicates, webhookEventDuplicates
  ] = await Promise.all([
    duplicateGroups(c("bookings"), "$bookingReference", nonEmptyString("bookingReference")),
    duplicateGroups(c("bookings"), "$bokunBookingId", nonEmptyString("bokunBookingId")),
    duplicateGroups(c("bookings"), { bokunExternalBookingReference: "$bokunExternalBookingReference" }, nonEmptyString("bokunExternalBookingReference")),
    duplicateGroups(c("bookings"), { externalChannelReference: "$externalChannelReference" }, nonEmptyString("externalChannelReference")),
    duplicateGroups(c("invoices"), "$bookingReference", nonEmptyString("bookingReference")),
    duplicateGroups(c("payments"), { provider: "$provider", providerTransactionId: "$providerTransactionId" }, { ...nonEmptyString("providerTransactionId"), provider: { $type: "string", $gt: "" } }),
    duplicateGroups(c("payments"), { provider: "$provider", orderTrackingId: "$orderTrackingId" }, { ...nonEmptyString("orderTrackingId"), provider: { $type: "string", $gt: "" } }),
    duplicateGroups(c("paymentallocations"), "$allocationKey", nonEmptyString("allocationKey")),
    duplicateGroups(c("paymentallocations"), "$idempotencyKey", nonEmptyString("idempotencyKey")),
    duplicateGroups(c("refunds"), { provider: "$provider", providerRefundReference: "$providerRefundReference" }, { ...nonEmptyString("providerRefundReference"), provider: { $type: "string", $gt: "" } }),
    duplicateGroups(c("refunds"), "$idempotencyKey", nonEmptyString("idempotencyKey")),
    duplicateGroups(c("journalentries"), "$postingKey", nonEmptyString("postingKey")),
    duplicateGroups(c("accountingpostings"), "$postingKey", nonEmptyString("postingKey")),
    duplicateGroups(c("accountingpostings"), "$idempotencyKey", nonEmptyString("idempotencyKey")),
    duplicateGroups(c("providerwebhookevents"), "$eventKey", nonEmptyString("eventKey"))
  ]);
  return buildAuditReport({
    bookingReferenceDuplicates, bokunBookingIdDuplicates, bokunExternalReferenceDuplicates,
    externalChannelReferenceGroups, invoiceDuplicates, providerTransactionDuplicates,
    providerOrderDuplicates, paymentAllocationDuplicates, allocationIdempotencyDuplicates,
    refundDuplicates, refundIdempotencyDuplicates, postingKeyDuplicates,
    accountingPostingKeyDuplicates, accountingIdempotencyDuplicates, webhookEventDuplicates
  });
};

module.exports = {
  runDuplicateAudit,
  duplicateGroups,
  buildAuditReport,
  classifySharedExternalChannelReferences,
  DUPLICATE_CLASSIFICATION
};
