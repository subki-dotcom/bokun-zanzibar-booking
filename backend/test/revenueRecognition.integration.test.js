process.env.MONGO_URI ||= 'mongodb://127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'revenue-isolated-test-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { createRevenueRecognitionService } = require('../src/services/revenueRecognition');
const { completionKey } = require('../src/services/serviceCompletion');
const config = {
  ACCOUNTING_BASE_CURRENCY: 'USD',
  REVENUE_RECOGNITION_AUTOMATIC_ENABLED: true,
  REVENUE_RECOGNITION_ACTIVATED_AT: '2026-09-21T09:00:00Z',
  REVENUE_RECOGNITION_ACTIVATION_SCOPE: 'NEW_COMPLETIONS',
};
const now = () => new Date('2026-09-22T12:00:00Z');

test(
  'revenue recognition with real isolated MongoDB transactions',
  { skip: !process.env.REVENUE_TEST_MONGO_URI },
  async (t) => {
    const uri = process.env.REVENUE_TEST_MONGO_URI;
    assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\/revenue_test\?replicaSet=revenueTest$/);
    const dbName = `revenue_test_${process.pid}_${Date.now()}`;
    const connection = await mongoose
      .createConnection(uri, { dbName, autoIndex: false })
      .asPromise();
    const names = [
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
    ];
    const M = Object.fromEntries(
      names.map((name) => [
        name,
        connection.model(name, require(`../src/models/${name}`).schema.clone()),
      ])
    );
    try {
      for (const model of Object.values(M)) {
        await model.createCollection();
        await model.createIndexes();
      }
      await M.ChartOfAccount.create([
        { code: '1020', name: 'Bank', type: 'ASSET', subtype: 'BANK' },
        { code: '1100', name: 'Customer AR', type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE' },
        { code: '1110', name: 'GYG AR', type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE' },
        { code: '1120', name: 'Viator AR', type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE' },
        { code: '1130', name: 'Other OTA AR', type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE' },
        { code: '2030', name: 'Advances', type: 'LIABILITY', subtype: 'CUSTOMER_DEPOSIT' },
        { code: '2040', name: 'Refund payable', type: 'LIABILITY', subtype: 'REFUND_PAYABLE' },
        { code: '4010', name: 'Tour revenue', type: 'REVENUE', subtype: 'TOUR_REVENUE' },
        { code: '4020', name: 'Transfer revenue', type: 'REVENUE', subtype: 'TRANSFER_REVENUE' },
        { code: '7010', name: 'FX gain', type: 'OTHER_INCOME', subtype: 'OTHER_INCOME' },
        { code: '7910', name: 'Refund allowance', type: 'OTHER_EXPENSE', subtype: 'REFUNDS_AND_ALLOWANCES' },
        { code: '7990', name: 'FX loss', type: 'OTHER_EXPENSE', subtype: 'OTHER_EXPENSE' },
      ]);
      await M.AccountingMapping.create([
        { mappingKey: 'ACCOUNTS_RECEIVABLE', accountCode: '1100' },
        { mappingKey: 'GYG_RECEIVABLE', accountCode: '1110' },
        { mappingKey: 'VIATOR_RECEIVABLE', accountCode: '1120' },
        { mappingKey: 'OTA_RECEIVABLE', accountCode: '1130' },
        { mappingKey: 'TOUR_REVENUE', accountCode: '4010' },
        { mappingKey: 'FX_GAIN', accountCode: '7010' },
        { mappingKey: 'FX_LOSS', accountCode: '7990' },
        { mappingKey: 'REFUND_ALLOWANCE', accountCode: '7910' },
        { mappingKey: 'REFUND_PAYABLE', accountCode: '2040' },
      ]);
      await M.AccountingPeriod.create({
        periodKey: '2026-09',
        label: 'September',
        year: 2026,
        month: 9,
        startDate: '2026-09-01',
        endDate: '2026-09-30T23:59:59.999Z',
        status: 'OPEN',
      });
      const service = (overrides = {}) =>
        createRevenueRecognitionService({ models: M, connection, config, now, ...overrides });
      let serial = 0;
      const fixture = async (bookingChanges = {}, completionChanges = {}) => {
        serial += 1;
        const booking = await M.Booking.create({
          customer: { customerId: new mongoose.Types.ObjectId() },
          bookingReference: `RR-TEST-${serial}`,
          bokunProductId: 'tour1',
          bokunOptionId: 'option1',
          productTitle: 'Tour',
          optionTitle: 'Standard',
          travelDate: '2026-09-21',
          bookingStatus: 'confirmed',
          salesChannel: 'DIRECT_WEBSITE',
          pricingSnapshot: { finalPayable: 100, currency: 'USD' },
          createdAt: '2026-09-21T10:00:00Z',
          ...bookingChanges,
        });
        const serviceKey = completionChanges.serviceKey || 'tour1';
        const completion = await M.ServiceCompletion.create({
          completionKey: completionKey({ bookingId: booking._id, serviceKey }),
          bookingId: booking._id,
          bookingReference: booking.bookingReference,
          serviceKey,
          status: 'COMPLETED',
          evidenceSource: 'GUIDE_CONFIRMATION',
          createdBy: 'guide1',
          externalReference: 'manifest1',
          verifiedAt: '2026-09-21T12:00:00Z',
          completedAt: '2026-09-21T12:00:00Z',
          createdAt: '2026-09-21T12:00:00Z',
          ...completionChanges,
        });
        return { booking, completion, input: { completionId: completion._id } };
      };
      const lines = (booking) => M.JournalEntryLine.find({ bookingId: String(booking._id) }).lean();
      const assertNoPosting = async (f) => {
        assert.equal(await M.RevenueRecognition.countDocuments({ bookingId: f.booking._id }), 0);
        assert.equal((await lines(f.booking)).length, 0);
        assert.equal(
          await M.JournalEntry.countDocuments({
            'source.sourceReference': f.booking.bookingReference,
          }),
          0
        );
      };
      const seedDeposit = async (f, value) => {
        const common = {
          entryNumber: `DEP-${f.booking.bookingReference}`,
          entryDate: new Date('2026-09-21T10:30:00Z'),
          postingDate: new Date('2026-09-21T10:30:00Z'),
          period: '2026-09',
          currency: 'USD',
          baseCurrency: 'USD',
          exchangeRate: '1',
        };
        const journal = await M.JournalEntry.create({
          ...common,
          description: 'Verified advance fixture',
          status: 'POSTED',
          source: {
            sourceModule: 'MANUAL',
            postingType: 'MANUAL_JOURNAL',
            postingKey: common.entryNumber,
          },
          totalDebit: value,
          totalCredit: value,
          baseTotalDebit: value,
          baseTotalCredit: value,
          lineCount: 2,
        });
        for (const [code, debit, credit] of [
          ['1020', value, '0'],
          ['2030', '0', value],
        ]) {
          const account = await M.ChartOfAccount.findOne({ code });
          await M.JournalEntryLine.create({
            ...common,
            journalEntryId: journal._id,
            journalStatus: 'POSTED',
            accountId: account._id,
            accountCode: code,
            accountName: account.name,
            accountType: account.type,
            accountSubtype: account.subtype,
            debit,
            credit,
            baseCurrencyDebit: debit,
            baseCurrencyCredit: credit,
            bookingId: String(f.booking._id),
            bookingReference: f.booking.bookingReference,
          });
        }
      };
      await t.test(
        'completed unpaid direct service posts Customer AR and revenue, no cash',
        async () => {
          const f = await fixture();
          const result = await service().post(f.input);
          assert.equal(result.action, 'posted');
          assert.deepEqual(
            (await lines(f.booking)).map((line) => [
              line.accountCode,
              String(line.debit),
              String(line.credit),
            ]),
            [
              ['1100', '100.00', '0.00'],
              ['4010', '0.00', '100.00'],
            ]
          );
          assert.equal(
            (await M.ServiceCompletion.findById(f.completion._id)).revenueStatus,
            'POSTED'
          );
          assert.equal(
            await M.Payment.countDocuments({ bookingReference: f.booking.bookingReference }),
            0
          );
          const ledger = require('../src/services/generalLedger/ledger').createGeneralLedgerService(
            { JournalEntryLineModel: M.JournalEntryLine, ChartOfAccountModel: M.ChartOfAccount }
          );
          const profitLoss = await ledger.getProfitLoss({});
          assert.equal(profitLoss.totals.revenue, '100');
        }
      );
      for (const [channel, net, code] of [
        ['GETYOURGUIDE', '14.96', '1110'],
        ['VIATOR', '115.60', '1120'],
        ['TOURHQ', '50.00', '1130'],
      ]) {
        await t.test(
          `${channel} posts verified supplier net once, without commission expense or cash`,
          async () => {
            const f = await fixture({
              salesChannel: channel,
              bookingPaymentStatus: 'PAID',
              bokunFinancialEvidence: {
                source: 'BOKUN',
                status: 'VERIFIED',
                grossAmount: 22,
                otaCommissionAmount: 7.04,
                expectedSellerInvoiceAmount: net,
                expectedSellerInvoiceCurrency: 'USD',
                evidenceHash: 'supplier-proof',
                marketplaceResellerId: 'reseller1',
              },
            });
            const result = await service().post(f.input);
            assert.equal(result.action, 'posted', JSON.stringify(result.eligibility?.blockers));
            assert.deepEqual(
              (await lines(f.booking)).map((line) => [
                line.accountCode,
                String(line.debit),
                String(line.credit),
              ]),
              [
                [code, net, '0.00'],
                ['4010', '0.00', net],
              ]
            );
            assert.equal(result.recognition.debtor.type, 'OTA');
          }
        );
      }
      await t.test('gross-only OTA and unproven direct amounts create no journals', async () => {
        for (const changes of [
          { salesChannel: 'VIATOR' },
          { pricingSnapshot: null, amount: 100 },
        ]) {
          const f = await fixture(changes);
          assert.equal((await service().post(f.input)).action, 'blocked');
          await assertNoPosting(f);
        }
      });
      await t.test(
        'full and partial prepayment release posted deposit balances, not payment flags',
        async () => {
          for (const value of ['100', '40']) {
            const f = await fixture({ paymentStatus: 'paid' });
            await seedDeposit(f, value);
            const result = await service().post(f.input);
            assert.equal(result.action, 'posted');
            const posted = await M.JournalEntryLine.find({
              journalEntryId: result.recognition.journalEntryId,
            }).lean();
            assert.equal(
              String(posted.find((line) => line.accountCode === '2030').debit),
              `${value}.00`
            );
            assert.equal(
              String(posted.find((line) => line.accountCode === '4010').credit),
              '100.00'
            );
            assert.equal(
              posted.some((line) => line.accountCode === '1020'),
              false
            );
            assert.equal(
              String(posted.find((line) => line.accountCode === '1100')?.debit || 0),
              value === '40' ? '60.00' : '0'
            );
          }
          const unclassified = await fixture({ paymentStatus: 'paid' });
          assert.equal((await service().post(unclassified.input)).action, 'blocked');
          await assertNoPosting(unclassified);
          const excessive = await fixture({ paymentStatus: 'paid' });
          await seedDeposit(excessive, '120');
          assert.equal((await service().post(excessive.input)).action, 'blocked');
          assert.equal(
            await M.RevenueRecognition.countDocuments({ bookingId: excessive.booking._id }),
            0
          );
        }
      );
      await t.test(
        'preview cannot combine completion A with booking B and never writes',
        async () => {
          const f = await fixture();
          const preview = await service().preview({ ...f.input, bookingReference: 'different' });
          assert.equal(preview.eligible, false);
          assert.ok(preview.blockers.includes('COMPLETION_BOOKING_MISMATCH'));
          await assertNoPosting(f);
        }
      );
      await t.test('missing OTA mapping and closed period block posting', async () => {
        const f = await fixture({
          salesChannel: 'VIATOR',
          bokunFinancialEvidence: {
            source: 'BOKUN',
            status: 'VERIFIED',
            expectedSellerInvoiceAmount: '115.60',
            expectedSellerInvoiceCurrency: 'USD',
            evidenceHash: 'v1',
          },
        });
        await M.AccountingMapping.updateOne(
          { mappingKey: 'VIATOR_RECEIVABLE' },
          { $set: { active: false } }
        );
        const missingMapping = await service().post(f.input);
        assert.equal(missingMapping.action, 'blocked');
        assert.ok(missingMapping.blockers.includes('REVENUE_AUTOMATIC_READINESS_REQUIRED'));
        await M.AccountingMapping.updateOne(
          { mappingKey: 'VIATOR_RECEIVABLE' },
          { $set: { active: true } }
        );
        await M.AccountingPeriod.updateOne(
          { periodKey: '2026-09' },
          { $set: { status: 'CLOSED' } }
        );
        assert.ok(
          (await service().post(f.input)).eligibility.blockers.includes(
            'OPEN_ACCOUNTING_PERIOD_REQUIRED'
          )
        );
        await M.AccountingPeriod.updateOne({ periodKey: '2026-09' }, { $set: { status: 'OPEN' } });
        await assertNoPosting(f);
      });
      await t.test(
        'paid, future, no-show, cancellation and contradictory evidence do not post',
        async () => {
          for (const [b, c] of [
            [{ paymentStatus: 'paid' }, { status: 'SCHEDULED' }],
            [{ bookingStatus: 'cancelled' }, {}],
            [{}, { status: 'NO_SHOW' }],
            [{}, { externalStatus: 'NO_SHOW' }],
            [{}, { completedAt: '2027-01-01' }],
          ]) {
            const f = await fixture(b, c);
            assert.equal((await service().post(f.input)).action, 'blocked');
            await assertNoPosting(f);
          }
        }
      );
      await t.test('EUR uses verified date FX; no rate means review without journal', async () => {
        const f = await fixture({ pricingSnapshot: { finalPayable: 100, currency: 'EUR' } });
        const blocked = await service().post(f.input);
        assert.equal(blocked.eligibility.status, 'NEEDS_REVIEW_FX');
        await assertNoPosting(f);
        await service().verifyEvidence({
          ...f.input,
          auth: { id: 'accountant' },
          input: {
            reference: 'FX-1',
            reason: 'Approved bank quote',
            fx: {
              rate: '1.18',
              source: 'approved-bank',
              date: '2026-09-21',
              fromCurrency: 'EUR',
              toCurrency: 'USD',
            },
          },
        });
        const result = await service().post(f.input);
        assert.equal(result.action, 'posted');
        assert.equal(String(result.recognition.recognizedAmount), '118.00');
        assert.equal(result.recognition.originalCurrency, 'EUR');
        assert.equal(String(result.recognition.originalAmount), '100');
        assert.equal(String((await lines(f.booking))[0].baseCurrencyDebit), '118.00');
      });
      await t.test(
        'sequential and concurrent retries produce one journal and one recognition',
        async () => {
          const f = await fixture();
          const results = await Promise.all(
            Array.from({ length: 8 }, () => service().post(f.input))
          );
          assert.equal(results.filter((result) => result.action === 'posted').length, 1);
          assert.equal((await service().post(f.input)).action, 'existing');
          assert.equal(await M.RevenueRecognition.countDocuments({ bookingId: f.booking._id }), 1);
          assert.equal(
            await M.JournalEntry.countDocuments({
              'source.sourceReference': f.booking.bookingReference,
            }),
            1
          );
          assert.equal((await lines(f.booking)).length, 2);
        }
      );
      for (const point of ['afterHeader', 'afterLine', 'beforeCommit']) {
        await t.test(
          `failure ${point} rolls back header, all lines, recognition, completion and audit`,
          async () => {
            const f = await fixture();
            await assert.rejects(
              service({
                checkpoint: async (name) => {
                  if (name === point) {
                    await assertNoPosting(f);
                    throw new Error('injected-failure');
                  }
                },
              }).post(f.input),
              /injected-failure/
            );
            await assertNoPosting(f);
            assert.equal((await M.ServiceCompletion.findById(f.completion._id)).revenueStatus, '');
            assert.equal(
              await M.AuditLog.countDocuments({ reference: f.booking.bookingReference }),
              0
            );
            assert.equal((await service().post(f.input)).action, 'posted');
          }
        );
      }
      await t.test(
        'activation is explicit, event-based, and excludes old or exact-boundary completion events',
        async () => {
          const f = await fixture();
          for (const override of [
            { REVENUE_RECOGNITION_ACTIVATED_AT: '' },
            { REVENUE_RECOGNITION_ACTIVATION_SCOPE: '' },
            { REVENUE_RECOGNITION_ACTIVATED_AT: '2026-09-22T10:00:00Z' },
          ]) {
            assert.equal(
              (await service({ config: { ...config, ...override } }).post(f.input)).action,
              'blocked'
            );
            await assertNoPosting(f);
          }
          const historicalBooking = await fixture({ createdAt: '2020-01-01' });
          assert.equal((await service().post(historicalBooking.input)).action, 'posted');
          const old = await fixture({}, { completedAt: '2026-09-01T12:00:00Z' });
          assert.equal((await service().post(old.input)).action, 'blocked');
          await assertNoPosting(old);
          const exact = await fixture({}, {
            createdAt: '2026-09-21T09:00:00Z',
            verifiedAt: '2026-09-21T09:00:00Z',
            completedAt: '2026-09-21T09:00:00Z',
          });
          assert.equal((await service().post(exact.input)).action, 'blocked');
          await assertNoPosting(exact);
          assert.equal(
            (
              await service({
                config: { ...config, REVENUE_RECOGNITION_AUTOMATIC_ENABLED: false },
              }).post(f.input)
            ).action,
            'preview'
          );
          await assertNoPosting(f);
        }
      );
      await t.test(
        'only completed component is earned; consistent allocation permits next component',
        async () => {
          const components = [
            { serviceKey: 'transfer', amount: '30' },
            { serviceKey: 'tour', amount: '70' },
          ];
          const revenueEvidence = {
            status: 'VERIFIED',
            verifiedBy: 'accountant',
            verifiedAt: now(),
            reference: 'allocation1',
            components,
          };
          const f = await fixture(
            {
              productTitle: 'Package',
              rawBokunResponse: { activityBookings: [{ id: 'transfer' }, { id: 'tour' }] },
            },
            { serviceKey: 'transfer', serviceName: 'Transfer', revenueEvidence }
          );
          const first = await service().post(f.input);
          assert.equal(first.action, 'posted');
          assert.equal(String(first.recognition.recognizedAmount), '30.00');
          assert.equal((await lines(f.booking)).length, 2);
          const c = await M.ServiceCompletion.create({
            ...f.completion.toObject(),
            _id: undefined,
            completionKey: completionKey({ bookingId: f.booking._id, serviceKey: 'tour' }),
            serviceKey: 'tour',
            serviceName: 'Tour',
          });
          const second = await service().post({ completionId: c._id });
          assert.equal(second.action, 'posted');
          assert.equal(String(second.recognition.recognizedAmount), '70.00');
        }
      );
      await t.test(
        'legitimate zero records evidence once without zero-value journals',
        async () => {
          const f = await fixture({ pricingSnapshot: { finalPayable: 0, currency: 'USD' } });
          assert.equal((await service().post(f.input)).action, 'zero_revenue');
          assert.equal((await lines(f.booking)).length, 0);
          assert.equal((await service().post(f.input)).action, 'existing');
        }
      );
      await t.test(
        'approved partial and full refund produce linked compensating journals only',
        async () => {
          const f = await fixture();
          const posted = await service().post(f.input);
          const refund = await M.Refund.create({
            refundReference: 'refund1',
            bookingId: f.booking._id,
            bookingRequestId: new mongoose.Types.ObjectId(),
            amount: 100,
            accountingRefundAmount: '100',
            accountingRefundCurrency: 'USD',
            currency: 'USD',
            status: 'approved',
            reason: 'Owner approved refund',
          });
          const originalJournal = await M.JournalEntry.findById(
            posted.recognition.journalEntryId
          ).lean();
          const input = {
            kind: 'REFUND',
            refundId: String(refund._id),
            originalAmount: '40',
            currency: 'USD',
            postingDate: '2026-09-22',
            reference: 'refund-part1',
            reason: 'Verified price refund',
            balanceEvidenceReference: 'AR-review1',
            creditMappingKey: 'ACCOUNTS_RECEIVABLE',
          };
          const args = { recognitionId: posted.recognition._id, input, auth: { id: 'accountant' } };
          const first = await service().reverse(args);
          assert.equal(String(first.recognition.recognizedAmount), '40.00');
          assert.equal((await service().reverse(args)).action, 'existing');
          await service().reverse({
            ...args,
            input: { ...input, reference: 'refund-part2', originalAmount: '60' },
          });
          assert.equal(
            (await M.RevenueRecognition.findById(posted.recognition._id)).status,
            'REVERSED'
          );
          assert.deepEqual(
            await M.JournalEntry.findById(originalJournal._id).lean(),
            originalJournal
          );
          const revenue = (await lines(f.booking)).filter((line) => line.accountType === 'REVENUE');
          assert.equal(
            revenue.reduce((sum, row) => sum + Number(row.credit) - Number(row.debit), 0),
            0
          );
          await assert.rejects(
            service().reverse({
              ...args,
              input: { ...input, reference: 'excess', originalAmount: '1' },
            }),
            /INVALID_REVERSAL_AMOUNT/
          );
        }
      );
      await t.test(
        'completion reversal starts review; authorized correction preserves original journal',
        async () => {
          const f = await fixture();
          const posted = await service().post(f.input);
          await service().requestCompletionReversal({
            ...f.input,
            reason: 'Incorrect completion',
            auth: { id: 'admin' },
          });
          assert.equal(
            (await M.ServiceCompletion.findById(f.completion._id)).revenueStatus,
            'NEEDS_REVIEW'
          );
          assert.equal((await lines(f.booking)).length, 2);
          await service().reverse({
            recognitionId: posted.recognition._id,
            auth: { id: 'accountant' },
            input: {
              kind: 'COMPLETION_REVERSAL',
              originalAmount: '100',
              currency: 'USD',
              postingDate: '2026-09-22',
              reference: 'completion-correction',
              reason: 'Service not delivered',
              balanceEvidenceReference: 'AR-review',
              creditMappingKey: 'ACCOUNTS_RECEIVABLE',
            },
          });
          assert.equal((await lines(f.booking)).length, 4);
        }
      );
    } finally {
      // This connection names a newly created test database only, never the configured application DB.
      assert.match(connection.name, /^revenue_test_\d+_\d+$/);
      await connection.dropDatabase();
      await connection.close();
    }
  }
);
