const test = require('node:test');
const assert = require('node:assert/strict');
const { createGlPreviewService } = require('../src/services/glPosting/preview');

test('GL preview uses canonical recognition and preserves the existing UI shape', async () => {
  let passed;
  const service = createGlPreviewService({
    RevenueService: {
      preview: async (input) => {
        passed = input;
        return {
          policyId: 'RISER_REVENUE_V1_SUPPLIER_NET',
          usdAmount: '14.96',
          eligibility: 'SAFE_TO_POST',
          blockers: [],
          journalLines: [
            { accountCode: '1110', debit: '14.96', credit: '0' },
            { accountCode: '4010', debit: '0', credit: '14.96' },
          ],
        };
      },
    },
  });
  const result = await service.previewRevenue({
    completionId: 'completion1',
    bookingReference: 'booking1',
  });
  assert.deepEqual(passed, { completionId: 'completion1', bookingReference: 'booking1' });
  assert.equal(result.totalDebit, '14.96');
  assert.equal(result.totalCredit, '14.96');
  assert.equal(result.commercialAmount, '14.96');
  assert.equal(result.currency, 'USD');
  assert.equal(result.policy.version, 1);
});
test('canonical blockers retain UI code/message shape', async () => {
  const service = createGlPreviewService({
    RevenueService: {
      preview: async () => ({
        blockers: ['VERIFIED_RECOGNITION_DATE_FX_REQUIRED'],
        journalLines: [],
      }),
    },
  });
  const result = await service.previewRevenue({ completionId: 'c1' });
  assert.equal(result.blockers[0].code, 'VERIFIED_RECOGNITION_DATE_FX_REQUIRED');
  assert.match(result.blockers[0].message, /fx required/);
});
