const { toDecimal } = require('../../utils/money');
const revenueRecognition = require('../revenueRecognition');

// Both preview screens use the same rules and identity as actual recognition.
const createGlPreviewService = ({ RevenueService = revenueRecognition } = {}) => ({
  previewRevenue: async (input) => {
    const result = await RevenueService.preview(input);
    const lines = result.journalLines || [];
    const totalDebit = lines.reduce((sum, line) => sum.plus(line.debit), toDecimal(0)).toFixed(2);
    const totalCredit = lines.reduce((sum, line) => sum.plus(line.credit), toDecimal(0)).toFixed(2);
    return {
      ...result,
      commercialAmount: result.usdAmount,
      currency: 'USD',
      policy: { id: result.policyId, version: 1 },
      totalDebit,
      totalCredit,
      balanced: totalDebit === totalCredit,
      blockers: result.blockers.map((code) => ({
        code,
        message: code.replaceAll('_', ' ').toLowerCase(),
      })),
    };
  },
});
module.exports = { createGlPreviewService };
