import { lazy } from "react";
import { Navigate, Route, useParams } from "react-router-dom";
import ProtectedRoute from "../../../shared/src/components/common/ProtectedRoute";
import AdminLayout from "../layouts/admin/AdminLayout";
import AdminUnavailablePage from "../components/admin/AdminUnavailablePage";
import { ADMIN_PERMISSIONS } from "../config/adminNavigation";
import { BACK_OFFICE_ROLES } from "./backOfficeAccess";

// Static import paths let Vite split each admin page into its own chunk; a variable path cannot be resolved
// at build time and would 404 in production.
const AdminCreateUserPage = lazy(() => import("../pages/admin/AdminCreateUserPage"));
const AdminInvoicesPage = lazy(() => import("../pages/admin/AdminInvoicesPage"));
const AdminDashboardPage = lazy(() => import("../pages/admin/AdminDashboardPage"));
const AdminBookingsPage = lazy(() => import("../pages/admin/AdminBookingsPage"));
const AdminAgentsPage = lazy(() => import("../pages/admin/AdminAgentsPage"));
const AdminPaymentsPage = lazy(() => import("../pages/admin/AdminPaymentsPage"));
const AdminRecoveryPage = lazy(() => import("../pages/admin/AdminRecoveryPage"));
const SyncLogsPage = lazy(() => import("../pages/admin/SyncLogsPage"));
const AdminBokunSyncPage = lazy(() => import("../pages/admin/AdminBokunSyncPage"));
const AdminBookingRequestsPage = lazy(() => import("../pages/admin/AdminBookingRequestsPage"));
const AdminBookingRequestDetailsPage = lazy(() => import("../pages/admin/AdminBookingRequestDetailsPage"));
const AdminOperationsPage = lazy(() => import("../pages/admin/AdminOperationsPage"));
const AdminBusinessIntelligencePage = lazy(() => import("../pages/admin/AdminBusinessIntelligencePage"));
const AdminDisasterRecoveryPage = lazy(() => import("../pages/admin/AdminDisasterRecoveryPage"));
const AdminSystemHealthPage = lazy(() => import("../pages/admin/AdminSystemHealthPage"));
const AdminPerformanceReviewPage = lazy(() => import("../pages/admin/AdminPerformanceReviewPage"));
const AdminProductionReadinessPage = lazy(() => import("../pages/admin/AdminProductionReadinessPage"));
const AdminBookingAccountingPage = lazy(() => import("../pages/admin/AdminBookingAccountingPage"));
const AdminBusinessAccountingPage = lazy(() => import("../pages/admin/AdminBusinessAccountingPage"));
const AdminChartOfAccountsPage = lazy(() => import("../pages/admin/AdminChartOfAccountsPage"));
const AdminCrmPage = lazy(() => import("../pages/admin/AdminCrmPage"));
const AdminGeneralLedgerRegisterPage = lazy(() => import("../pages/admin/AdminGeneralLedgerRegisterPage"));
const AdminJournalEntriesPage = lazy(() => import("../pages/admin/AdminJournalEntriesPage"));
const AdminTrialBalancePage = lazy(() => import("../pages/admin/AdminTrialBalancePage"));
const AdminAccountsPayablePage = lazy(() => import("../pages/admin/AdminAccountsPayablePage"));
const AdminAccountsReceivablePage = lazy(() => import("../pages/admin/AdminAccountsReceivablePage"));
const AdminCashBankPage = lazy(() => import("../pages/admin/AdminCashBankPage"));
const AdminPeriodClosePage = lazy(() => import("../pages/admin/AdminPeriodClosePage"));
const AdminBalanceSheetPage = lazy(() => import("../pages/admin/AdminBalanceSheetPage"));
const AdminProfitLossPage = lazy(() => import("../pages/admin/AdminProfitLossPage"));
const AdminCashFlowPage = lazy(() => import("../pages/admin/AdminCashFlowPage"));
const AdminFixedAssetsPage = lazy(() => import("../pages/admin/AdminFixedAssetsPage"));
const AdminAccountingReconciliationPage = lazy(() => import("../pages/admin/AdminAccountingReconciliationPage"));
const AdminSettlementsPage = lazy(() => import("../pages/admin/AdminSettlementsPage"));
const AdminSettlementDetailPage = lazy(() => import("../pages/admin/AdminSettlementDetailPage"));
const AdminSettlementImportPage = lazy(() => import("../pages/admin/AdminSettlementImportPage"));
const AdminServiceCompletionPage = lazy(() => import("../pages/admin/AdminServiceCompletionPage"));
const AdminGlPostingPreviewPage = lazy(() => import("../pages/admin/AdminGlPostingPreviewPage"));
const AdminBookingReconciliationPage = lazy(() => import("../pages/admin/AdminBookingReconciliationPage"));
const AdminReportCenterPage = lazy(() => import("../pages/admin/AdminReportCenterPage"));
const AdminAuditControlPage = lazy(() => import("../pages/admin/AdminAuditControlPage"));
const AdminDataQualityPage = lazy(() => import("../pages/admin/AdminDataQualityPage"));
const AdminOpsControlPage = lazy(() => import("../pages/admin/AdminOpsControlPage"));

const LegacyBookingRequestRedirect = () => {
  const { requestId } = useParams();
  return <Navigate to={`/admin/operations/booking-requests/${requestId}`} replace />;
};

// The admin route table, used by the Back Office and by the website's /admin fallback. It is called as a
// function (not rendered as a component) because <Routes> only accepts <Route> elements as children.
const adminRoutes = () => (
  <Route
    element={
      <ProtectedRoute roles={BACK_OFFICE_ROLES}>
        <AdminLayout />
      </ProtectedRoute>
    }
  >
    <Route path="/admin" element={<AdminDashboardPage />} />
    <Route path="/admin/settings/create-admin" element={<ProtectedRoute roles={["super_admin"]}><AdminCreateUserPage /></ProtectedRoute>} />
    <Route path="/admin/operations/dashboard" element={<AdminUnavailablePage module="Operations" title="Operations Dashboard" />} />
    <Route path="/admin/operations/bookings" element={<AdminBookingsPage />} />
    <Route path="/admin/operations/booking-requests" element={<AdminBookingRequestsPage />} />
    <Route path="/admin/operations/booking-requests/:requestId" element={<AdminBookingRequestDetailsPage />} />
    <Route path="/admin/operations/tour-operations" element={<AdminOperationsPage />} />
    <Route path="/admin/operations/recovery" element={<AdminRecoveryPage />} />
    <Route path="/admin/operations/agents" element={<AdminAgentsPage />} />
    <Route path="/admin/operations/bokun-sync/sync-logs" element={<SyncLogsPage />} />
    <Route path="/admin/operations/bokun-sync/confirmed-import" element={<AdminBokunSyncPage />} />
    <Route path="/admin/operations/bokun-sync/manual" element={<AdminBokunSyncPage />} />
    <Route path="/admin/operations/bokun-sync/single-booking" element={<AdminBokunSyncPage />} />
    <Route path="/admin/booking-accounting/dashboard" element={<AdminBookingAccountingPage />} />
    <Route path="/admin/booking-accounting/invoices" element={<AdminInvoicesPage />} />
    <Route path="/admin/booking-accounting/payments" element={<AdminPaymentsPage />} />
    <Route path="/admin/booking-accounting/refunds" element={<AdminBookingAccountingPage />} />
    <Route path="/admin/booking-accounting/expenses" element={<AdminBookingAccountingPage />} />
    <Route path="/admin/booking-accounting/cost-templates" element={<AdminBookingAccountingPage />} />
    <Route path="/admin/booking-accounting/cost-templates/new" element={<AdminBookingAccountingPage />} />
    <Route path="/admin/booking-accounting/cost-templates/:templateId" element={<AdminBookingAccountingPage />} />
    <Route path="/admin/booking-accounting/cost-templates/:templateId/edit" element={<AdminBookingAccountingPage />} />
    <Route path="/admin/booking-accounting/profitability" element={<AdminBookingAccountingPage />} />
    <Route path="/admin/booking-accounting/reconciliation" element={<ProtectedRoute permissions={[ADMIN_PERMISSIONS.BOOKING_ACCOUNTING_READ]}><AdminBookingReconciliationPage /></ProtectedRoute>} />
    <Route
      path="/admin/business-accounting"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.BUSINESS_ACCOUNTING_READ]}>
          <AdminBusinessAccountingPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/business-accounting/chart-of-accounts"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.GL_VIEW]}>
          <AdminChartOfAccountsPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/business-accounting/journal-entries"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.GL_VIEW]}>
          <AdminJournalEntriesPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/business-accounting/general-ledger"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.GL_VIEW]}>
          <AdminGeneralLedgerRegisterPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/business-accounting/trial-balance"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.GL_VIEW]}>
          <AdminTrialBalancePage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/business-accounting/accounts-receivable"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.BUSINESS_ACCOUNTING_READ]}>
          <AdminAccountsReceivablePage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/business-accounting/accounts-payable"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.BUSINESS_ACCOUNTING_READ]}>
          <AdminAccountsPayablePage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/business-accounting/cash-bank"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.GL_VIEW]}>
          <AdminCashBankPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/business-accounting/period-close"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.GL_CLOSE_PERIOD]}>
          <AdminPeriodClosePage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/business-accounting/balance-sheet"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.GL_VIEW_BALANCE_SHEET]}>
          <AdminBalanceSheetPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/business-accounting/profit-loss"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.GL_VIEW_PROFIT_LOSS]}>
          <AdminProfitLossPage />
        </ProtectedRoute>
      }
    />
    <Route path="/admin/business-accounting/cash-flow" element={<ProtectedRoute permissions={[ADMIN_PERMISSIONS.GL_VIEW_CASH_FLOW]}><AdminCashFlowPage /></ProtectedRoute>} />
    <Route path="/admin/business-accounting/fixed-assets" element={<ProtectedRoute permissions={[ADMIN_PERMISSIONS.GL_VIEW]}><AdminFixedAssetsPage /></ProtectedRoute>} />
    <Route path="/admin/business-accounting/accounting-reconciliation" element={<ProtectedRoute permissions={[ADMIN_PERMISSIONS.GL_VIEW]}><AdminAccountingReconciliationPage /></ProtectedRoute>} />
    <Route path="/admin/business-accounting/settlements" element={<ProtectedRoute permissions={[ADMIN_PERMISSIONS.SETTLEMENT_VIEW]}><AdminSettlementsPage /></ProtectedRoute>} />
    <Route path="/admin/business-accounting/settlements/:settlementId" element={<ProtectedRoute permissions={[ADMIN_PERMISSIONS.SETTLEMENT_VIEW]}><AdminSettlementDetailPage /></ProtectedRoute>} />
    <Route path="/admin/business-accounting/settlements/import" element={<ProtectedRoute permissions={[ADMIN_PERMISSIONS.SETTLEMENT_VIEW]}><AdminSettlementImportPage /></ProtectedRoute>} />
    <Route path="/admin/business-accounting/service-completion" element={<ProtectedRoute permissions={[ADMIN_PERMISSIONS.SERVICE_COMPLETION_VIEW]}><AdminServiceCompletionPage /></ProtectedRoute>} />
    <Route path="/admin/business-accounting/gl-posting-preview" element={<ProtectedRoute permissions={[ADMIN_PERMISSIONS.GL_PREVIEW_POSTING]}><AdminGlPostingPreviewPage /></ProtectedRoute>} />
    <Route
      path="/admin/business-intelligence"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.BUSINESS_INTELLIGENCE_READ]}>
          <AdminBusinessIntelligencePage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/report-center"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.REPORT_CENTER_READ]}>
          <AdminReportCenterPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/audit-control"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.AUDIT_CONTROL_READ]}>
          <AdminAuditControlPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/audit-control/data-quality"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.DATA_QUALITY_READ]}>
          <AdminDataQualityPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/audit-control/ops-control"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.OPS_CONTROL_READ]}>
          <AdminOpsControlPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/disaster-recovery"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.DISASTER_RECOVERY_READ]}>
          <AdminDisasterRecoveryPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/system-health"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.SYSTEM_HEALTH_READ]}>
          <AdminSystemHealthPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/performance-review"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.PERFORMANCE_REVIEW_READ]}>
          <AdminPerformanceReviewPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/production-readiness"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.PRODUCTION_READINESS_READ]}>
          <AdminProductionReadinessPage />
        </ProtectedRoute>
      }
    />
    <Route path="/admin/settings" element={<AdminUnavailablePage module="Settings" title="Settings" />} />

    <Route path="/admin/bookings" element={<Navigate to="/admin/operations/bookings" replace />} />
    <Route path="/admin/agents" element={<Navigate to="/admin/operations/agents" replace />} />
    <Route path="/admin/payments" element={<Navigate to="/admin/booking-accounting/payments" replace />} />
    <Route path="/admin/booking-requests" element={<Navigate to="/admin/operations/booking-requests" replace />} />
    <Route path="/admin/booking-requests/:requestId" element={<LegacyBookingRequestRedirect />} />
    <Route path="/admin/recovery" element={<Navigate to="/admin/operations/recovery" replace />} />
    <Route path="/admin/sync-logs" element={<Navigate to="/admin/operations/bokun-sync/sync-logs" replace />} />
    <Route path="/admin/data-quality" element={<Navigate to="/admin/audit-control/data-quality" replace />} />
    <Route path="/admin/ops-control" element={<Navigate to="/admin/audit-control/ops-control" replace />} />
    <Route path="/admin/operations" element={<Navigate to="/admin/operations/tour-operations" replace />} />
    {[
      "/admin/crm",
      "/admin/crm/customers",
      "/admin/crm/leads"
    ].map((path) => (
      <Route
        key={path}
        path={path}
        element={
          <ProtectedRoute permissions={[ADMIN_PERMISSIONS.CRM_VIEW]}>
            <AdminCrmPage />
          </ProtectedRoute>
        }
      />
    ))}
    <Route
      path="/admin/crm/opportunities"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.CRM_MANAGE_OPPORTUNITIES]}>
          <AdminCrmPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/crm/pipeline"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.CRM_MANAGE_OPPORTUNITIES]}>
          <AdminCrmPage />
        </ProtectedRoute>
        }
      />
    <Route
      path="/admin/crm/quotes"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.CRM_MANAGE_QUOTES]}>
          <AdminCrmPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/crm/follow-ups"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.CRM_MANAGE_FOLLOWUPS]}>
          <AdminCrmPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/crm/tasks"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.CRM_MANAGE_FOLLOWUPS]}>
          <AdminCrmPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/crm/duplicates"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.CRM_MANAGE_CUSTOMERS]}>
          <AdminCrmPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/crm/conversations"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.CRM_VIEW_CUSTOMERS]}>
          <AdminCrmPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/crm/b2b-agents"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.CRM_MANAGE_B2B]}>
          <AdminCrmPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/crm/lost-opportunities"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.CRM_MANAGE_OPPORTUNITIES]}>
          <AdminCrmPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/crm/reports"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.CRM_VIEW_SALES_ANALYTICS]}>
          <AdminCrmPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/crm/controls"
      element={
        <ProtectedRoute permissions={[ADMIN_PERMISSIONS.CRM_VIEW_SALES_ANALYTICS]}>
          <AdminCrmPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/crm/imports"
      element={
        <ProtectedRoute
          permissions={[
            ADMIN_PERMISSIONS.CRM_MANAGE_CUSTOMERS,
            ADMIN_PERMISSIONS.CRM_MANAGE_LEADS,
            ADMIN_PERMISSIONS.CRM_MANAGE_B2B
          ]}
        >
          <AdminCrmPage />
        </ProtectedRoute>
      }
    />
  </Route>
);

export default adminRoutes;
