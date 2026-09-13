const ReportExport = require('../models/ReportExport');
const User = require('../models/User');
const { resolveAnalyticsPeriod, resolveComparisonPeriod, safePercentageChange } = require('../analytics/periods');

const createSummaryService = ({ ExportModel = ReportExport, UserModel = User, now = () => new Date() } = {}) => {
  const getSummary = async (filters = {}) => {
    const instant = now();
    const period = resolveAnalyticsPeriod({ ...filters, now: instant });
    const comparison = resolveComparisonPeriod({ currentRange: period, compare: 'PREVIOUS_PERIOD' });
    const month = resolveAnalyticsPeriod({ period: 'THIS_MONTH', now: instant });
    const previousMonth = resolveAnalyticsPeriod({ period: 'LAST_MONTH', now: instant });
    const count = (range) => ExportModel.countDocuments({ status: 'completed', ...(range?.isBounded ? { generatedAt: { $gte: range.from, $lt: range.to } } : {}) });
    const [generated, previous, monthly, priorMonthly, users] = await Promise.all([
      count(period), comparison?.range ? count(comparison.range) : Promise.resolve(null),
      count(month), count(previousMonth), UserModel.countDocuments({ isActive: true })
    ]);
    return {
      period, comparison, generatedAt: instant.toISOString(),
      kpis: {
        totalReportsGenerated: { value: generated, supported: true, comparison: previous === null ? null : safePercentageChange(generated, previous), description: 'Completed export records generated during the selected period; previews are not recorded.' },
        scheduledReports: { value: null, supported: false, description: 'Report scheduling is not supported by the current platform.' },
        exportsThisMonth: { value: monthly, supported: true, period: month, comparison: safePercentageChange(monthly, priorMonthly), description: 'Completed exports in the current calendar month, compared with the previous calendar month.' },
        activeUsers: { value: users, supported: true, description: 'Currently enabled staff and administrator accounts, not live sessions or period activity.' }
      }
    };
  };
  return { getSummary };
};
module.exports = { ...createSummaryService(), createSummaryService };
