process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/report-center-route-test";
process.env.JWT_SECRET ||= "report-center-route-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const User = require("../src/models/User");
const { REPORT_EXPORT_FORMAT, REPORT_TYPE } = require("../src/reportCenter/constants");
const reportExportService = require("../src/reportCenter/exportService");
const reportCenterService = require("../src/reportCenter/reportQueryService");

const adminId = "66bbbbbbbbbbbbbbbbbbbbbb";

const adminToken = () =>
  jwt.sign(
    {
      sub: adminId,
      userType: "user"
    },
    process.env.JWT_SECRET,
    { expiresIn: "5m" }
  );

const withMockAdmin = () => {
  const originalFindById = User.findById;
  User.findById = () => ({
    lean: async () => ({
      _id: { toString: () => adminId },
      role: "admin",
      isActive: true,
      email: "admin@example.test"
    })
  });
  return () => {
    User.findById = originalFindById;
  };
};

const listen = async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
};

const close = (server) =>
  new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

test("report center catalog route requires admin auth and returns query rules", async () => {
  const restoreUser = withMockAdmin();
  const server = await listen();

  try {
    const { port } = server.address();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/report-center/catalog`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`http://127.0.0.1:${port}/api/admin/report-center/catalog`, {
      headers: {
        Authorization: `Bearer ${adminToken()}`
      }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.queryRules.reportsUseCanonicalServices, true);
    assert.ok(payload.data.reports.some((report) => report.type === REPORT_TYPE.SALES_SUMMARY));
    assert.ok(payload.data.reports.some((report) => report.type === REPORT_TYPE.DAILY_MANAGEMENT_REPORT));
    assert.ok(payload.data.reports.some((report) => report.type === REPORT_TYPE.PRODUCT_BEST_SELLERS));
    assert.ok(payload.data.reports.some((report) => report.type === REPORT_TYPE.PROFITABILITY_OVERVIEW));
    assert.ok(payload.data.reports.some((report) => report.type === REPORT_TYPE.MANAGEMENT_CASH_FLOW_REPORT));
    assert.ok(payload.data.reports.some((report) => report.type === REPORT_TYPE.RECEIVABLES_AGING_REPORT));
  } finally {
    restoreUser();
    await close(server);
  }
});

test("report center run route validates report type and forwards auth/request context", async () => {
  const restoreUser = withMockAdmin();
  const originalRunReport = reportCenterService.runReport;
  let capturedArgs = null;
  reportCenterService.runReport = async (args) => {
    capturedArgs = args;
    return {
      report: { type: args.reportType },
      generatedAt: "2026-08-15T10:30:00.000Z",
      filters: args.filters,
      data: { ok: true }
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/report-center/reports/${REPORT_TYPE.PRODUCT_BEST_SELLERS}?period=THIS_MONTH&productId=P-1`,
      {
        headers: {
          Authorization: `Bearer ${adminToken()}`,
          "x-request-id": "report-route-req-1"
        }
      }
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(capturedArgs.reportType, REPORT_TYPE.PRODUCT_BEST_SELLERS);
    assert.equal(capturedArgs.filters.period, "THIS_MONTH");
    assert.equal(capturedArgs.filters.productId, "P-1");
    assert.equal(capturedArgs.auth.id, adminId);
    assert.equal(capturedArgs.requestId, "report-route-req-1");

    const invalid = await fetch(`http://127.0.0.1:${port}/api/admin/report-center/reports/NOPE`, {
      headers: {
        Authorization: `Bearer ${adminToken()}`
      }
    });
    assert.equal(invalid.status, 422);
  } finally {
    reportCenterService.runReport = originalRunReport;
    restoreUser();
    await close(server);
  }
});

test("report center export route streams generated files and forwards same report filters", async () => {
  const restoreUser = withMockAdmin();
  const originalExportReport = reportExportService.exportReport;
  let capturedArgs = null;
  reportExportService.exportReport = async (args) => {
    capturedArgs = args;
    return {
      report: { type: args.reportType },
      format: args.format,
      content: "Product,Bookings\r\nSpice Tour,2",
      contentType: "text/csv; charset=utf-8",
      contentLength: Buffer.byteLength("Product,Bookings\r\nSpice Tour,2"),
      filename: "PRODUCT_BEST_SELLERS.csv",
      disposition: "attachment",
      rowCount: 1,
      history: { id: "export-route-1" }
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/report-center/reports/${REPORT_TYPE.PRODUCT_BEST_SELLERS}/export?format=${REPORT_EXPORT_FORMAT.CSV}&period=THIS_MONTH&productId=P-1`,
      {
        headers: {
          Authorization: `Bearer ${adminToken()}`,
          "x-request-id": "report-export-route-1"
        }
      }
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/csv/);
    assert.match(response.headers.get("content-disposition"), /^attachment/);
    assert.equal(response.headers.get("x-report-export-format"), REPORT_EXPORT_FORMAT.CSV);
    assert.equal(response.headers.get("x-report-export-id"), "export-route-1");
    assert.equal(body, "Product,Bookings\r\nSpice Tour,2");
    assert.equal(capturedArgs.reportType, REPORT_TYPE.PRODUCT_BEST_SELLERS);
    assert.equal(capturedArgs.format, REPORT_EXPORT_FORMAT.CSV);
    assert.deepEqual(capturedArgs.filters, {
      period: "THIS_MONTH",
      productId: "P-1"
    });
    assert.equal(capturedArgs.auth.id, adminId);
    assert.equal(capturedArgs.requestId, "report-export-route-1");

    const invalid = await fetch(
      `http://127.0.0.1:${port}/api/admin/report-center/reports/${REPORT_TYPE.PRODUCT_BEST_SELLERS}/export?format=WORD`,
      {
        headers: {
          Authorization: `Bearer ${adminToken()}`
        }
      }
    );
    assert.equal(invalid.status, 422);
  } finally {
    reportExportService.exportReport = originalExportReport;
    restoreUser();
    await close(server);
  }
});

test("report center export history route returns tracked response-only exports", async () => {
  const restoreUser = withMockAdmin();
  const originalListExportHistory = reportExportService.listExportHistory;
  let capturedArgs = null;
  reportExportService.listExportHistory = async (args) => {
    capturedArgs = args;
    return {
      items: [
        {
          id: "export-history-1",
          reportType: args.reportType,
          format: args.format,
          status: "completed",
          rowCount: 2
        }
      ],
      count: 1,
      retainedFilesSupported: false
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/report-center/exports/history?reportType=${REPORT_TYPE.SALES_SUMMARY}&format=${REPORT_EXPORT_FORMAT.CSV}&limit=5`,
      {
        headers: {
          Authorization: `Bearer ${adminToken()}`
        }
      }
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(capturedArgs, {
      reportType: REPORT_TYPE.SALES_SUMMARY,
      format: REPORT_EXPORT_FORMAT.CSV,
      limit: 5
    });
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].id, "export-history-1");
    assert.equal(payload.data.retainedFilesSupported, false);
  } finally {
    reportExportService.listExportHistory = originalListExportHistory;
    restoreUser();
    await close(server);
  }
});
