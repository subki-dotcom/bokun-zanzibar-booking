require('dotenv').config();

const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { createRevenueRecognitionService } = require('../src/services/revenueRecognition');

const modelNames = [
  'Booking',
  'Invoice',
  'Payment',
  'ServiceCompletion',
  'RevenueRecognition',
  'JournalEntry',
  'JournalEntryLine',
  'AccountingPosting',
  'AccountingMapping',
  'ChartOfAccount',
  'AccountingPeriod',
  'AuditLog',
  'Refund',
];

const models = Object.fromEntries(
  modelNames.map((name) => [name, require(`../src/models/${name}`)])
);

const writeMethods = [
  'create',
  'insertMany',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findByIdAndUpdate',
  'deleteOne',
  'deleteMany',
  'bulkWrite',
  'replaceOne',
];

const guardWrites = () => {
  for (const model of Object.values(models)) {
    for (const method of writeMethods) {
      model[method] = () => {
        throw new Error('WRITE_FORBIDDEN_IN_PREVIEW');
      };
    }
  }
};

const latest = async (model, field) => {
  const row = await model.findOne({ [field]: { $exists: true } }).sort({ [field]: -1 }).lean();
  return row?.[field] ? new Date(row[field]).toISOString() : null;
};

const fingerprint = async (model) => ({
  count: await model.countDocuments({}),
  maxId: String((await model.findOne({}).sort({ _id: -1 }).select('_id').lean())?._id || ''),
  maxUpdatedAt: await latest(model, 'updatedAt'),
  maxCreatedAt: await latest(model, 'createdAt'),
});

const fingerprints = async () =>
  Object.fromEntries(
    await Promise.all(
      ['JournalEntry', 'JournalEntryLine', 'AccountingPosting', 'ServiceCompletion', 'Invoice', 'Payment', 'RevenueRecognition'].map(
        async (name) => [name, await fingerprint(models[name])]
      )
    )
  );

const countBy = (rows, field) =>
  rows.reduce((counts, row) => {
    const key = String(row[field] || 'UNKNOWN').toUpperCase();
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

const needsReview = async (model) =>
  model.countDocuments({
    $or: [
      { status: /^NEEDS_REVIEW/ },
      { revenueStatus: /^NEEDS_REVIEW/ },
      { accountingStatus: /^NEEDS_REVIEW/ },
    ],
  });

const sample = (completion, booking, preview) => ({
  bookingReference: completion.bookingReference,
  serviceKey: completion.serviceKey,
  completedAt: completion.completedAt || null,
  verifiedAt: completion.verifiedAt || null,
  createdAt: completion.createdAt || null,
  completionStatus: completion.status,
  channel: booking.salesChannel || booking.sourceChannel || null,
  blockers: preview.blockers || [],
  activationBlockers: preview.activationBlockers || [],
  postingIdentity: preview.postingIdentity || null,
  postingDate: preview.postingDate || null,
  currency: preview.currency || null,
  commercialAmount: preview.commercialAmount ?? null,
  recognizedAmount: preview.recognizedAmount ?? null,
  journalLines: preview.journalLines || [],
  debitAccount: preview.debitAccount || null,
  creditAccount: preview.creditAccount || null,
  mappingSource: preview.debtor?.mappingKey || null,
});

const run = async () => {
  const candidate = new Date();
  const candidateIso = candidate.toISOString();
  const previewConfig = {
    ...env,
    REVENUE_RECOGNITION_AUTOMATIC_ENABLED: true,
    REVENUE_RECOGNITION_ACTIVATED_AT: candidateIso,
    REVENUE_RECOGNITION_ACTIVATION_SCOPE: 'NEW_COMPLETIONS',
  };

  await mongoose.connect(env.MONGO_URI, { autoIndex: false });
  try {
    guardWrites();
    const before = await fingerprints();
    const service = createRevenueRecognitionService({
      models,
      connection: mongoose.connection,
      config: previewConfig,
      now: () => new Date(candidate),
    });
    const [bookings, invoices, payments, completions, recognitions] = await Promise.all([
      models.Booking.find({}).lean(),
      models.Invoice.find({}).lean(),
      models.Payment.find({}).lean(),
      models.ServiceCompletion.find({}).lean(),
      models.RevenueRecognition.find({}).lean(),
    ]);
    const bookingById = new Map(bookings.map((booking) => [String(booking._id), booking]));
    const classifications = { wouldAutoPost: [], wouldRemainBlocked: [], historicalExcluded: [] };
    const blockerBreakdown = {};

    for (const completion of completions) {
      const booking = bookingById.get(String(completion.bookingId)) || {};
      let preview;
      try {
        preview = await service.preview({ completionId: String(completion._id) });
      } catch (error) {
        preview = { blockers: [error.code || error.message], activationBlockers: [] };
      }
      for (const blocker of [...(preview.blockers || []), ...(preview.activationBlockers || [])])
        blockerBreakdown[blocker] = (blockerBreakdown[blocker] || 0) + 1;
      const item = sample(completion, booking, preview);
      if (preview.automaticEligible) classifications.wouldAutoPost.push(item);
      else if ((preview.activationBlockers || []).includes('OUTSIDE_ACTIVATION_BOUNDARY'))
        classifications.historicalExcluded.push(item);
      else classifications.wouldRemainBlocked.push(item);
    }

    const completionByBooking = new Map();
    for (const completion of completions) {
      const items = completionByBooking.get(String(completion.bookingId)) || [];
      items.push(completion);
      completionByBooking.set(String(completion.bookingId), items);
    }
    const futureEligible = bookings.filter((booking) =>
      !(completionByBooking.get(String(booking._id)) || []).some((completion) =>
        [completion.createdAt, completion.verifiedAt, completion.completedAt].every(
          (timestamp) => timestamp && new Date(timestamp) > candidate
        )
      )
    ).length;
    const needsReviewByModel = Object.fromEntries(
      await Promise.all(
        ['Booking', 'Invoice', 'Payment', 'ServiceCompletion', 'RevenueRecognition'].map(
          async (name) => [name, await needsReview(models[name])]
        )
      )
    );
    const after = await fingerprints();
    const fingerprintsUnchanged = Object.fromEntries(
      Object.keys(before).map((name) => [name, JSON.stringify(before[name]) === JSON.stringify(after[name])])
    );
    const recognitionJournals = await models.JournalEntry.countDocuments({
      'source.sourceEntityType': 'RevenueRecognition',
    });

    console.log(
      JSON.stringify(
        {
          candidateActivationTimestamp: candidateIso,
          inventory: {
            totalBookings: bookings.length,
            bookingStatusCounts: countBy(bookings, 'bookingStatus'),
            confirmedBookings: bookings.filter((booking) => String(booking.bookingStatus).toUpperCase() === 'CONFIRMED').length,
            cancelledBookings: bookings.filter((booking) => /CANCEL/.test(String(booking.bookingStatus).toUpperCase())).length,
            noShowBookings: bookings.filter((booking) => /NO_SHOW|NOSHOW/.test(String(booking.bookingStatus).toUpperCase())).length,
            invoices: invoices.length,
            payments: payments.length,
            serviceCompletionEvents: completions.length,
            completionStatusCounts: countBy(completions, 'status'),
            existingRecognitionJournals: recognitionJournals,
            recognitionStatusCounts: countBy(recognitions, 'status'),
            needsReviewByModel,
            needsReviewTotal: Object.values(needsReviewByModel).reduce((total, count) => total + count, 0),
          },
          preview: {
            wouldAutoPostImmediately: classifications.wouldAutoPost.length,
            wouldRemainBlocked: classifications.wouldRemainBlocked.length,
            historicalExcluded: classifications.historicalExcluded.length,
            futureEligible,
          },
          blockerBreakdown: Object.fromEntries(
            Object.entries(blockerBreakdown).sort(([, left], [, right]) => right - left)
          ),
          autoPostSamples: classifications.wouldAutoPost.slice(0, 3),
          blockedSamples: classifications.wouldRemainBlocked.slice(0, 3),
          historicalSamples: classifications.historicalExcluded.slice(0, 3),
          fingerprintsUnchanged,
        },
        null,
        2
      )
    );
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});