const mongoose = require('mongoose');
const { env } = require('../../config/env');
const AppError = require('../../utils/AppError');
const { toDecimal } = require('../../utils/money');
const { DEFAULT_ACCOUNTING_MAPPINGS } = require('../../accounting/defaultAccountingMappings');
const { evaluateRevenue, activationBlockers, hash, amount } = require('./policy');
const { createRevenueReadinessService } = require('./readiness');

const defaultModels = Object.fromEntries(
  [
    'Booking',
    'ServiceCompletion',
    'RevenueRecognition',
    'JournalEntry',
    'JournalEntryLine',
    'AccountingMapping',
    'AccountingPeriod',
    'ChartOfAccount',
    'AuditLog',
    'Refund',
    'Payment',
  ].map((name) => [name, require(`../../models/${name}`)])
);
const fail = (code) => {
  throw new AppError(code, 409, code, { status: 'NEEDS_REVIEW', postingAllowed: false });
};
const read = (query, session) => query.session(session || null).lean();
const createRevenueRecognitionService = ({
  models = defaultModels,
  connection = mongoose.connection,
  config = env,
  now = () => new Date(),
  checkpoint = async () => {},
} = {}) => {
  const M = models;
  const readiness = createRevenueReadinessService({ models: M, connection, config, now });
  const audit = async ({ action, completion, auth = {}, after, reason = '', session }) =>
    M.AuditLog.create(
      [
        {
          action,
          entityType: 'RevenueRecognition',
          entityId: String(completion._id),
          reference: completion.bookingReference,
          actorId: auth.id || 'revenue-policy-v1',
          actorRole: auth.role || 'system',
          reason,
          after,
        },
      ],
      { session }
    );
  const account = async (key, session) => {
    const mapping = await read(M.AccountingMapping.findOne({ mappingKey: key }), session);
    const code = mapping
      ? mapping.active
        ? mapping.accountCode
        : null
      : DEFAULT_ACCOUNTING_MAPPINGS.find((item) => item.mappingKey === key)?.accountCode;
    const mapped = code
      ? await read(M.ChartOfAccount.findOne({ code, active: true }), session)
      : null;
    return mapped ? { ...mapped, mappingId: mapping?._id || null } : null;
  };
  const load = async (completionId, session) => {
    const completion = await read(M.ServiceCompletion.findById(completionId), session);
    if (!completion) fail('COMPLETION_NOT_FOUND');
    const booking = await read(M.Booking.findById(completion.bookingId), session);
    if (!booking) fail('BOOKING_NOT_FOUND');
    return { booking, completion };
  };
  const completeJournal = async (journalId, session) => {
    const journal = await read(M.JournalEntry.findById(journalId), session);
    const lines = await read(M.JournalEntryLine.find({ journalEntryId: journalId }), session);
    if (
      !journal ||
      !['POSTED', 'REVERSED'].includes(journal.status) ||
      journal.lineCount !== lines.length ||
      lines.length < 2
    )
      return false;
    const debit = lines.reduce(
      (sum, line) => sum.plus(String(line.baseCurrencyDebit)),
      toDecimal(0)
    );
    const credit = lines.reduce(
      (sum, line) => sum.plus(String(line.baseCurrencyCredit)),
      toDecimal(0)
    );
    return (
      debit.gt(0) &&
      debit.eq(credit) &&
      debit.eq(String(journal.baseTotalDebit)) &&
      credit.eq(String(journal.baseTotalCredit)) &&
      lines.every(
        (line) => line.baseCurrency === 'USD' && ['POSTED', 'REVERSED'].includes(line.journalStatus)
      )
    );
  };
  const evaluate = async ({ booking, completion, session }) => {
    const result = evaluateRevenue({
      booking,
      completion,
      baseCurrency: config.ACCOUNTING_BASE_CURRENCY,
      now: now(),
    });
    const blockers = [...result.blockers];
    const existing = await read(
      M.RevenueRecognition.findOne({ postingKey: result.postingKey }),
      session
    );
    const refunds = await read(
      M.Refund.find({
        bookingId: booking._id,
        status: { $nin: ['rejected', 'cancelled', 'failed'] },
      }),
      session
    );
    if (refunds.length) blockers.push('REFUND_REVIEW_REQUIRED');
    if (existing) {
      if (
        existing.allocationHash !== result.allocationHash ||
        existing.originalCurrency !== result.originalCurrency ||
        result.usdAmount === null ||
        !toDecimal(String(existing.recognizedAmount)).eq(result.usdAmount)
      )
        blockers.push('RECOGNIZED_EVIDENCE_CHANGED');
      if (
        existing.status !== 'ZERO_REVENUE' &&
        (!existing.journalEntryId || !(await completeJournal(existing.journalEntryId, session)))
      )
        blockers.push('INCOMPLETE_RECOGNITION_JOURNAL');
      return {
        ...result,
        eligible: false,
        status: blockers.length ? 'NEEDS_REVIEW' : existing.status,
        existing,
        blockers: blockers.length ? [...new Set(blockers)] : ['ALREADY_RECOGNIZED'],
      };
    }
    const siblings = await read(
      M.ServiceCompletion.find({
        bookingId: booking._id,
        serviceKey: completion.serviceKey,
        status: { $in: ['NO_SHOW', 'CANCELLED', 'DISPUTED', 'REVERSED'] },
      }),
      session
    );
    if (siblings.length) blockers.push('CONTRADICTORY_COMPLETION_EVIDENCE');
    const prior = await read(
      M.RevenueRecognition.find({ bookingId: booking._id, reversalOf: null }),
      session
    );
    if (prior.some((row) => row.allocationHash !== result.allocationHash))
      blockers.push('COMPONENT_ALLOCATION_CHANGED');
    const legacy = await read(
      M.JournalEntryLine.find({
        bookingReference: booking.bookingReference,
        accountType: 'REVENUE',
        journalStatus: { $in: ['POSTED', 'REVERSED'] },
        sourceEntityType: { $ne: 'RevenueRecognition' },
      }),
      session
    );
    if (legacy.length) blockers.push('EXISTING_REVENUE_REQUIRES_RECONCILIATION');
    const period = result.recognitionDate
      ? await read(
          M.AccountingPeriod.findOne({
            startDate: { $lte: result.recognitionDate },
            endDate: { $gte: result.recognitionDate },
            status: 'OPEN',
          }),
          session
        )
      : null;
    if (!period) blockers.push('OPEN_ACCOUNTING_PERIOD_REQUIRED');
    const debit = await account(result.debtor.mappingKey, session);
    const credit = await account(result.revenueMappingKey, session);
    if (!debit || debit.type !== 'ASSET' || debit.subtype !== 'ACCOUNTS_RECEIVABLE')
      blockers.push('RECEIVABLE_ACCOUNT_MAPPING_REQUIRED');
    if (!credit || credit.type !== 'REVENUE') blockers.push('REVENUE_ACCOUNT_MAPPING_REQUIRED');
    if (result.debtor.type === 'OTA') {
      const customerAccount = await account('ACCOUNTS_RECEIVABLE', session);
      if (customerAccount && debit?.code === customerAccount.code)
        blockers.push('OTA_ACCOUNT_MUST_NOT_BE_CUSTOMER_AR');
    }
    const lines = [];
    let receivableUsd = result.usdAmount;
    if (result.debtor.type === 'CUSTOMER' && receivableUsd !== null) {
      const payments = await read(
        M.Payment.find({ bookingReference: booking.bookingReference, status: 'paid' }),
        session
      );
      const deposit = await account('CUSTOMER_DEPOSIT', session);
      const deposits = deposit
        ? await read(
            M.JournalEntryLine.find({
              bookingReference: booking.bookingReference,
              accountCode: deposit.code,
              journalStatus: { $in: ['POSTED', 'REVERSED'] },
            }),
            session
          )
        : [];
      for (const journalId of new Set(deposits.map((line) => String(line.journalEntryId)))) {
        if (!(await completeJournal(journalId, session)))
          blockers.push('INCOMPLETE_DEPOSIT_JOURNAL');
      }
      const balance = deposits.reduce(
        (sum, line) =>
          sum.plus(String(line.baseCurrencyCredit)).minus(String(line.baseCurrencyDebit)),
        toDecimal(0)
      );
      const reportsPaid = ['PAID', 'PARTIAL', 'PARTIALLY_PAID', 'OVERPAID'].includes(
        String(booking.paymentStatus || '').toUpperCase()
      );
      if (payments.length || reportsPaid || deposits.length) {
        if (
          result.originalCurrency !== 'USD' ||
          !deposit ||
          deposit.type !== 'LIABILITY' ||
          balance.lte(0) ||
          balance.gt(receivableUsd)
        )
          blockers.push('PREPAYMENT_ACCOUNTING_REVIEW_REQUIRED');
        else {
          lines.push({ account: deposit, debit: balance.toFixed(2), credit: '0.00' });
          receivableUsd = toDecimal(receivableUsd).minus(balance).toFixed(2);
        }
      }
    }
    if (debit && receivableUsd !== null && toDecimal(receivableUsd).gt(0))
      lines.push({ account: debit, debit: receivableUsd, credit: '0.00' });
    if (credit && result.usdAmount !== null && toDecimal(result.usdAmount).gt(0))
      lines.push({ account: credit, debit: '0.00', credit: result.usdAmount });
    return {
      ...result,
      eligible: !blockers.length,
      status: blockers.length
        ? result.status === 'NEEDS_REVIEW_FX'
          ? result.status
          : 'NEEDS_REVIEW'
        : result.status,
      blockers: [...new Set(blockers)],
      period,
      lines,
    };
  };
  const preview = async ({ completionId, bookingReference = '' }) => {
    const context = await load(completionId);
    const result = await evaluate(context);
    if (bookingReference && bookingReference !== context.booking.bookingReference) {
      result.eligible = false;
      result.status = 'NEEDS_REVIEW';
      result.blockers.push('COMPLETION_BOOKING_MISMATCH');
    }
    const boundary = activationBlockers({ config, ...context, now: now() });
    return {
      ...result,
      automaticEnabled: config.REVENUE_RECOGNITION_AUTOMATIC_ENABLED === true,
      activationBlockers: boundary,
      automaticEligible:
        result.eligible &&
        !boundary.length &&
        config.REVENUE_RECOGNITION_AUTOMATIC_ENABLED === true,
      journalLines: (result.lines || []).map((line) => ({
        accountCode: line.account.code,
        debit: line.debit,
        credit: line.credit,
      })),
      eligibility: result.eligible ? 'SAFE_TO_POST' : result.status,
      postingIdentity: result.postingKey,
      postingDate: result.recognitionDate,
      currency: 'USD',
      commercialAmount: result.originalAmount,
      recognizedAmount: result.usdAmount,
      blockReason: result.blockers.join(','),
      debitAccount: result.lines?.[0]?.account.code || null,
      creditAccount: result.lines?.at(-1)?.account.code || null,
      warnings: ['PREVIEW_ONLY: no journal has been posted.'],
    };
  };
  // Existing unique indexes are checked, never created or repaired on application startup.
  const requireUniqueIndexes = async () => {
    for (const [model, field] of [
      [M.RevenueRecognition, 'postingKey'],
      [M.JournalEntry, 'source.postingKey'],
    ]) {
      const indexes = await model.collection.indexes();
      if (
        !indexes.some(
          (index) =>
            index.unique &&
            index.key[field] === 1 &&
            Object.keys(index.key).length === 1 &&
            !index.partialFilterExpression
        )
      )
        fail('REVENUE_UNIQUE_INDEX_REQUIRED');
    }
  };
  const transaction = async (work) => {
    await requireUniqueIndexes();
    const session = await connection.startSession();
    try {
      return await session.withTransaction(() => work(session), {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      });
    } finally {
      await session.endSession();
    }
  };
  const lock = async (model, document, session) =>
    model.updateOne({ _id: document._id }, { $inc: { __v: 1 } }, { session, timestamps: false });
  const writeJournal = async ({
    recognition,
    result,
    completion,
    auth,
    session,
    reversalOf = null,
  }) => {
    const totalDebit = result.lines.reduce((sum, line) => sum.plus(line.debit), toDecimal(0));
    const totalCredit = result.lines.reduce((sum, line) => sum.plus(line.credit), toDecimal(0));
    if (!totalDebit.gt(0) || !totalDebit.eq(totalCredit)) fail('UNBALANCED_REVENUE_JOURNAL');
    const timestamp = now();
    const source = {
      sourceModule: 'BOOKING_ACCOUNTING',
      sourceEntityType: 'RevenueRecognition',
      sourceEntityId: String(recognition._id),
      sourceReference: completion.bookingReference,
      postingType: reversalOf ? 'REFUND_APPROVAL' : 'CUSTOMER_INVOICE',
      postingKey: recognition.postingKey,
    };
    const shared = {
      entryNumber: `RR-${hash(recognition.postingKey).slice(0, 28)}`,
      entryDate: result.recognitionDate,
      postingDate: result.recognitionDate,
      period: result.period.periodKey,
      currency: 'USD',
      baseCurrency: 'USD',
      exchangeRate: '1',
      exchangeRateDate: result.recognitionDate,
      exchangeRateSource: 'RECOGNITION_USD',
      description: reversalOf
        ? 'Controlled service revenue reversal'
        : 'Verified completed service revenue',
    };
    const [journal] = await M.JournalEntry.create(
      [
        {
          ...shared,
          source,
          status: 'POSTED',
          totalDebit: totalDebit.toFixed(2),
          totalCredit: totalCredit.toFixed(2),
          baseTotalDebit: totalDebit.toFixed(2),
          baseTotalCredit: totalCredit.toFixed(2),
          lineCount: result.lines.length,
          createdBy: auth.id || 'revenue-policy-v1',
          postedBy: auth.id || 'revenue-policy-v1',
          postedAt: timestamp,
          requiresApproval: false,
          reversalOf,
          evidence: recognition.evidence,
          metadata: {
            origin: recognition.origin,
            policyId: recognition.policyId,
            debtor: recognition.debtor,
            originalAmount: String(recognition.originalAmount),
            originalCurrency: recognition.originalCurrency,
            fx: recognition.fx,
          },
        },
      ],
      { session }
    );
    await checkpoint('afterHeader', { session, journal });
    for (const [index, line] of result.lines.entries()) {
      await M.JournalEntryLine.create(
        [
          {
            ...shared,
            ...source,
            journalEntryId: journal._id,
            journalStatus: 'POSTED',
            accountId: line.account._id,
            accountCode: line.account.code,
            accountName: line.account.name,
            accountType: line.account.type,
            accountSubtype: line.account.subtype,
            debit: line.debit,
            credit: line.credit,
            baseCurrencyDebit: line.debit,
            baseCurrencyCredit: line.credit,
            bookingId: String(completion.bookingId),
            bookingReference: completion.bookingReference,
            metadata: {
              serviceKey: completion.serviceKey,
              debtor: recognition.debtor,
              recognitionId: String(recognition._id),
            },
          },
        ],
        { session }
      );
      await checkpoint('afterLine', { session, journal, index });
    }
    return journal;
  };
  const post = async ({ completionId, origin = 'AUTOMATIC', auth = {} }) => {
    if (origin === 'AUTOMATIC' && config.REVENUE_RECOGNITION_AUTOMATIC_ENABLED !== true)
      return { action: 'preview', eligibility: await preview({ completionId }) };
    if (origin === 'AUTOMATIC' && !(await readiness.assess()).ready)
      return { action: 'blocked', blockers: ['REVENUE_AUTOMATIC_READINESS_REQUIRED'] };
    return transaction(async (session) => {
      const context = await load(completionId, session);
      const { booking, completion } = context;
      // Serialize components, refunds and repeated callers at the booking boundary.
      await lock(M.Booking, booking, session);
      await lock(M.ServiceCompletion, completion, session);
      const result = await evaluate({ ...context, session });
      if (result.existing) {
        if (result.status === 'NEEDS_REVIEW')
          await M.ServiceCompletion.updateOne(
            { _id: completion._id },
            { $set: { revenueStatus: 'NEEDS_REVIEW', revenueBlockers: result.blockers } },
            { session }
          );
        return { action: 'existing', recognition: result.existing, eligibility: result };
      }
      const boundary = activationBlockers({ config, ...context, now: now() });
      result.blockers.push(...boundary);
      if (result.blockers.length) {
        const status = result.status === 'NEEDS_REVIEW_FX' ? result.status : 'NEEDS_REVIEW';
        await M.ServiceCompletion.updateOne(
          { _id: completion._id },
          { $set: { revenueStatus: status, revenueBlockers: result.blockers } },
          { session }
        );
        return { action: 'blocked', eligibility: { ...result, eligible: false, status } };
      }
      await lock(M.AccountingPeriod, result.period, session);
      for (const line of result.lines) {
        await lock(M.ChartOfAccount, line.account, session);
        if (line.account.mappingId)
          await lock(M.AccountingMapping, { _id: line.account.mappingId }, session);
      }
      const evidence = {
        basis: result.basis,
        allocation: result.allocation,
        completion: {
          id: String(completion._id),
          serviceKey: completion.serviceKey,
          evidenceSource: completion.evidenceSource,
          externalReference: completion.externalReference,
          completedAt: completion.completedAt,
          verifiedAt: completion.verifiedAt,
          verifiedBy: completion.createdBy,
        },
        supplementalReference: completion.revenueEvidence?.reference || '',
      };
      const [recognition] = await M.RevenueRecognition.create(
        [
          {
            recognitionReference: `RR-${hash(result.postingKey).slice(0, 28)}`,
            postingKey: result.postingKey,
            bookingId: booking._id,
            bookingReference: booking.bookingReference,
            serviceCompletionId: completion._id,
            serviceKey: completion.serviceKey,
            recognizedAmount: result.usdAmount,
            currency: 'USD',
            originalAmount: result.originalAmount,
            originalCurrency: result.originalCurrency,
            fx: result.fx,
            evidence,
            debtor: result.debtor,
            allocationHash: result.allocationHash,
            recognitionDate: result.recognitionDate,
            status: result.status === 'ZERO_REVENUE' ? 'ZERO_REVENUE' : 'POSTED',
            policyId: result.policyId,
            origin,
            createdBy: auth.id || 'revenue-policy-v1',
          },
        ],
        { session }
      );
      if (result.status !== 'ZERO_REVENUE') {
        const journal = await writeJournal({ recognition, result, completion, auth, session });
        recognition.journalEntryId = journal._id;
        await recognition.save({ session });
      }
      await M.ServiceCompletion.updateOne(
        { _id: completion._id },
        {
          $set: {
            revenueStatus: recognition.status,
            revenueBlockers: [],
            recognitionId: recognition._id,
          },
        },
        { session }
      );
      await audit({
        action: 'SERVICE_REVENUE_RECOGNIZED',
        completion,
        auth,
        session,
        after: {
          recognitionId: String(recognition._id),
          journalEntryId: recognition.journalEntryId,
          amount: result.usdAmount,
          currency: 'USD',
          origin,
          policyId: result.policyId,
        },
      });
      await checkpoint('beforeCommit', { session, recognition });
      return { action: result.status === 'ZERO_REVENUE' ? 'zero_revenue' : 'posted', recognition };
    });
  };
  const verifyEvidence = async ({ completionId, input, auth = {} }) =>
    transaction(async (session) => {
      const { completion, booking } = await load(completionId, session);
      await lock(M.Booking, booking, session);
      if (
        await read(M.RevenueRecognition.findOne({ serviceCompletionId: completion._id }), session)
      )
        fail('POSTED_EVIDENCE_IS_IMMUTABLE');
      if (!auth.id || !input.reference || !input.reason) fail('EVIDENCE_APPROVAL_REQUIRED');
      const revenueEvidence = {
        components: input.components || null,
        fx: input.fx || null,
        status: 'VERIFIED',
        verifiedBy: auth.id,
        verifiedAt: now(),
        reference: input.reference,
        reason: input.reason,
      };
      await M.ServiceCompletion.updateOne(
        { _id: completion._id },
        { $set: { revenueEvidence, revenueStatus: 'NEEDS_REVIEW' } },
        { session }
      );
      await audit({
        action: 'REVENUE_EVIDENCE_VERIFIED',
        completion,
        auth,
        session,
        reason: input.reason,
        after: revenueEvidence,
      });
      return { action: 'verified', completionId };
    });
  const requestCompletionReversal = async ({ completionId, auth = {}, reason }) =>
    transaction(async (session) => {
      if (!reason) fail('COMPLETION_REVERSAL_REASON_REQUIRED');
      const { completion, booking } = await load(completionId, session);
      await lock(M.Booking, booking, session);
      await M.ServiceCompletion.updateOne(
        { _id: completion._id },
        {
          $set: {
            status: 'REVERSED',
            revenueStatus: 'NEEDS_REVIEW',
            revenueBlockers: ['COMPLETION_REVERSAL_ACCOUNTING_REVIEW_REQUIRED'],
          },
        },
        { session }
      );
      await audit({
        action: 'SERVICE_COMPLETION_REVERSED',
        completion,
        auth,
        session,
        reason,
        after: { status: 'REVERSED', accounting: 'NEEDS_REVIEW' },
      });
      return {
        completion: { ...completion, status: 'REVERSED', revenueStatus: 'NEEDS_REVIEW' },
        replay: completion.status === 'REVERSED',
      };
    });
  const reverse = async ({ recognitionId, completionId = '', input, auth = {} }) =>
    transaction(async (session) => {
      if (!auth.id || !input.reason || !input.reference) fail('REVERSAL_APPROVAL_REQUIRED');
      const original = await read(M.RevenueRecognition.findById(recognitionId), session);
      if (!original || original.reversalOf || !original.journalEntryId)
        fail('POSTED_RECOGNITION_REQUIRED');
      if (!(await completeJournal(original.journalEntryId, session)))
        fail('INCOMPLETE_RECOGNITION_JOURNAL');
      const { booking, completion } = await load(original.serviceCompletionId, session);
      if (completionId && String(completion._id) !== String(completionId))
        fail('COMPLETION_BOOKING_MISMATCH');
      await lock(M.Booking, booking, session);
      const postingKey = `${original.postingKey}:adjustment:${hash(input.reference)}`;
      const existing = await read(M.RevenueRecognition.findOne({ postingKey }), session);
      if (existing) return { action: 'existing', recognition: existing };
      const value = amount(input.originalAmount);
      const remaining = toDecimal(String(original.originalAmount)).minus(
        String(original.reversedAmount || 0)
      );
      if (
        value === null ||
        toDecimal(value).lte(0) ||
        toDecimal(value).gt(remaining) ||
        input.currency !== original.originalCurrency
      )
        fail('INVALID_REVERSAL_AMOUNT');
      if (input.kind === 'COMPLETION_REVERSAL') {
        if (completion.status !== 'REVERSED' || !toDecimal(value).eq(remaining))
          fail('COMPLETION_REVERSAL_EVIDENCE_REQUIRED');
      } else if (input.kind === 'REFUND') {
        const refund = input.refundId
          ? await read(M.Refund.findById(input.refundId), session)
          : null;
        if (
          !refund ||
          String(refund.bookingId) !== String(booking._id) ||
          !['approved', 'refunded', 'partially_refunded'].includes(refund.status)
        )
          fail('VERIFIED_REFUND_REQUIRED');
        const verifiedAmount = amount(
          refund.confirmedAccountingRefundedAmount ??
            refund.accountingRefundAmount ??
            refund.confirmedRefundedAmount
        );
        if (
          !verifiedAmount ||
          toDecimal(verifiedAmount).lt(value) ||
          (refund.accountingRefundCurrency || refund.currency) !== input.currency
        )
          fail('REFUND_AMOUNT_EVIDENCE_REQUIRED');
        if (original.debtor.type === 'OTA' && !input.supplierAdjustmentReference)
          fail('VERIFIED_SUPPLIER_REFUND_ADJUSTMENT_REQUIRED');
        const applied = await read(
          M.RevenueRecognition.find({
            bookingId: booking._id,
            'evidence.refundId': String(refund._id),
          }),
          session
        );
        if (
          applied
            .reduce((sum, row) => sum.plus(String(row.originalAmount)), toDecimal(value))
            .gt(verifiedAmount)
        )
          fail('REFUND_ALREADY_ALLOCATED');
      } else fail('REVERSAL_KIND_REQUIRED');
      const postingDate = new Date(input.postingDate);
      if (
        !Number.isFinite(postingDate.getTime()) ||
        postingDate > now() ||
        postingDate < new Date(original.recognitionDate)
      )
        fail('REVERSAL_DATE_INVALID');
      const period = await read(
        M.AccountingPeriod.findOne({
          startDate: { $lte: postingDate },
          endDate: { $gte: postingDate },
          status: 'OPEN',
        }),
        session
      );
      if (!period) fail('OPEN_ACCOUNTING_PERIOD_REQUIRED');
      await lock(M.AccountingPeriod, period, session);
      const originalLines = await read(
        M.JournalEntryLine.find({ journalEntryId: original.journalEntryId }),
        session
      );
      const revenueLine = originalLines.find((line) => line.accountType === 'REVENUE');
      const creditAccount = await account(input.creditMappingKey, session);
      const debitAccount = revenueLine
        ? await read(M.ChartOfAccount.findById(revenueLine.accountId), session)
        : null;
      const permittedCredit = [original.debtor.mappingKey, 'REFUND_PAYABLE'];
      if (
        !permittedCredit.includes(input.creditMappingKey) ||
        !creditAccount?.active ||
        !debitAccount?.active ||
        !input.balanceEvidenceReference
      )
        fail('REVERSAL_BALANCE_TREATMENT_REQUIRED');
      if (
        debitAccount.type !== 'REVENUE' ||
        (input.creditMappingKey === 'REFUND_PAYABLE'
          ? creditAccount.type !== 'LIABILITY' || creditAccount.subtype !== 'REFUND_PAYABLE'
          : creditAccount.type !== 'ASSET' || creditAccount.subtype !== 'ACCOUNTS_RECEIVABLE')
      )
        fail('REVERSAL_ACCOUNT_MAPPING_INVALID');
      const previousAdjustments = await read(
        M.RevenueRecognition.find({ reversalOf: original._id }),
        session
      );
      const previousUsd = previousAdjustments.reduce(
        (sum, row) => sum.plus(String(row.recognizedAmount)),
        toDecimal(0)
      );
      const usdAmount = toDecimal(value).eq(remaining)
        ? toDecimal(String(original.recognizedAmount)).minus(previousUsd).toFixed(2)
        : toDecimal(value).times(original.fx.rate).toFixed(2);
      if (input.creditMappingKey === original.debtor.mappingKey) {
        const balanceLines = await read(
          M.JournalEntryLine.find({
            bookingReference: booking.bookingReference,
            accountCode: creditAccount.code,
            journalStatus: { $in: ['POSTED', 'REVERSED'] },
          }),
          session
        );
        const balance = balanceLines.reduce(
          (sum, line) =>
            sum.plus(String(line.baseCurrencyDebit)).minus(String(line.baseCurrencyCredit)),
          toDecimal(0)
        );
        if (balance.lt(usdAmount)) fail('REVERSAL_EXCEEDS_OPEN_RECEIVABLE');
      }
      await lock(M.ChartOfAccount, debitAccount, session);
      await lock(M.ChartOfAccount, creditAccount, session);
      const [recognition] = await M.RevenueRecognition.create(
        [
          {
            recognitionReference: `RR-${hash(postingKey).slice(0, 28)}`,
            postingKey,
            bookingId: booking._id,
            bookingReference: booking.bookingReference,
            serviceCompletionId: completion._id,
            serviceKey: completion.serviceKey,
            recognizedAmount: usdAmount,
            currency: 'USD',
            originalAmount: value,
            originalCurrency: original.originalCurrency,
            fx: original.fx,
            recognitionDate: postingDate,
            status: 'POSTED',
            reversalOf: original._id,
            policyId: original.policyId,
            origin: 'MANUAL',
            createdBy: auth.id,
            debtor: original.debtor,
            adjustmentReference: input.reference,
            evidence: {
              reason: input.reason,
              refundId: input.refundId || null,
              supplierAdjustmentReference: input.supplierAdjustmentReference || null,
              balanceEvidenceReference: input.balanceEvidenceReference,
              approvedBy: auth.id,
            },
          },
        ],
        { session }
      );
      const result = {
        recognitionDate: postingDate,
        period,
        lines: [
          { account: debitAccount, debit: usdAmount, credit: '0' },
          { account: creditAccount, debit: '0', credit: usdAmount },
        ],
      };
      const journal = await writeJournal({
        recognition,
        result,
        completion,
        auth,
        session,
        reversalOf: original.journalEntryId,
      });
      recognition.journalEntryId = journal._id;
      await recognition.save({ session });
      const reversedAmount = toDecimal(String(original.reversedAmount || 0)).plus(value);
      const status = reversedAmount.eq(String(original.originalAmount))
        ? 'REVERSED'
        : 'PARTIALLY_REVERSED';
      await M.RevenueRecognition.updateOne(
        { _id: original._id },
        { $set: { status, reversedAmount: reversedAmount.toFixed() } },
        { session }
      );
      await M.ServiceCompletion.updateOne(
        { _id: completion._id },
        { $set: { revenueStatus: status } },
        { session }
      );
      await audit({
        action: 'SERVICE_REVENUE_REVERSED',
        completion,
        auth,
        session,
        reason: input.reason,
        after: {
          recognitionId: recognition._id,
          originalRecognitionId: original._id,
          journalEntryId: journal._id,
          amount: usdAmount,
        },
      });
      return { action: 'reversed', recognition };
    });
  return {
    preview,
    post,
    verifyEvidence,
    requestCompletionReversal,
    reverse,
    requireUniqueIndexes,
    readiness,
  };
};
module.exports = { createRevenueRecognitionService, ...createRevenueRecognitionService() };
