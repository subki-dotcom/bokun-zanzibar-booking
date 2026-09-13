process.env.NODE_ENV = 'test';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/report-center-test';
process.env.JWT_SECRET ||= 'report-center-test-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSummaryService } = require('../src/reportCenter/summaryService');
const { createReportExportService } = require('../src/reportCenter/exportService');

test('summary counts completed exports with half-open periods and preserves unavailable metrics', async () => {
  const rows = [
    { status: 'completed', generatedAt: new Date('2026-08-31T21:00:00Z') },
    { status: 'completed', generatedAt: new Date('2026-09-08T10:00:00Z') },
    { status: 'failed', generatedAt: new Date('2026-09-08T11:00:00Z') },
    { status: 'completed', generatedAt: new Date('2026-08-10T10:00:00Z') }
  ];
  const service = createSummaryService({
    now: () => new Date('2026-09-09T09:00:00Z'),
    ExportModel: { countDocuments: async (query) => rows.filter((row) => row.status === query.status && (!query.generatedAt || row.generatedAt >= query.generatedAt.$gte && row.generatedAt < query.generatedAt.$lt)).length },
    UserModel: { countDocuments: async (query) => { assert.deepEqual(query, { isActive: true }); return 7; } }
  });
  const result = await service.getSummary({ period: 'THIS_MONTH' });
  assert.equal(result.kpis.totalReportsGenerated.value, 2);
  assert.equal(result.kpis.exportsThisMonth.value, 2);
  assert.equal(result.kpis.exportsThisMonth.comparison.previous, 1);
  assert.equal(result.kpis.activeUsers.value, 7);
  assert.equal(result.kpis.scheduledReports.value, null);
  assert.equal(result.kpis.scheduledReports.supported, false);
  const custom = await service.getSummary({ period: 'CUSTOM', from: '2026-09-08', to: '2026-09-08' });
  assert.equal(custom.kpis.totalReportsGenerated.value, 1);
  assert.equal(custom.kpis.exportsThisMonth.value, 2);
  assert.equal(custom.kpis.totalReportsGenerated.comparison.percentageChange, null);
});

test('history paginates, counts filters and resolves generator names in one batch', async () => {
  let skipped;
  let userQueries = 0;
  const id = '66bbbbbbbbbbbbbbbbbbbbbb';
  const service = createReportExportService({
    ExportModel: {
      find: (query) => { assert.equal(query.format, 'CSV'); return { sort: () => ({ skip: (value) => { skipped = value; return { limit: () => ({ lean: async () => [{ _id: 'export-3', generatedBy: id, metadata: { reportTitle: 'Sales Summary', period: { fromIso: '2026-08-01T00:00:00Z' } } }] }) }; } }) }; },
      countDocuments: async (query) => { assert.equal(query.format, 'CSV'); return 11; }
    },
    UserModel: { find: (query) => { userQueries += 1; assert.deepEqual(query._id.$in, [id]); return { select: () => ({ lean: async () => [{ _id: id, fullName: 'Report Admin' }] }) }; } }
  });
  const result = await service.listExportHistory({ format: 'CSV', page: 2, limit: 5 });
  assert.equal(skipped, 5);
  assert.equal(userQueries, 1);
  assert.deepEqual(result.pagination, { page: 2, limit: 5, total: 11, totalPages: 3 });
  assert.equal(result.items[0].generatedByLabel, 'Report Admin');
  assert.equal(result.items[0].reportTitle, 'Sales Summary');
  assert.ok(result.items[0].period.fromIso);
  assert.equal(result.retainedFilesSupported, false);
});
