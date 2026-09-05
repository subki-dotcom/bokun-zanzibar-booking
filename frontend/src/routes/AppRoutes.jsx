import { Navigate, Route, Routes, useParams } from "react-router-dom";
import PublicLayout from "../layouts/PublicLayout";
import DashboardLayout from "../layouts/DashboardLayout";
import AdminLayout from "../layouts/admin/AdminLayout";
import ProtectedRoute from "../components/common/ProtectedRoute";
import { ADMIN_PERMISSIONS } from "../config/adminNavigation";
import HomePage from "../pages/public/HomePage";
import ToursPage from "../pages/public/ToursPage";
import TourDetailsPage from "../pages/public/TourDetailsPage";
import BookingFlowPage from "../pages/public/BookingFlowPage";
import BookingConfirmationPage from "../pages/public/BookingConfirmationPage";
import PaymentSuccessPage from "../pages/public/PaymentSuccessPage";
import PaymentFailurePage from "../pages/public/PaymentFailurePage";
import PaymentStatusPage from "../pages/public/PaymentStatusPage";
import PaymentProcessingPage from "../pages/public/PaymentProcessingPage";
import PaymentCheckoutPage from "../pages/public/PaymentCheckoutPage";
import MyBookingPage from "../pages/public/MyBookingPage";
import InvoiceDetailsPage from "../pages/public/InvoiceDetailsPage";
import LoginPage from "../pages/public/LoginPage";
import AgentRegisterPage from "../pages/public/AgentRegisterPage";
import AdminDashboardPage from "../pages/admin/AdminDashboardPage";
import AdminBookingsPage from "../pages/admin/AdminBookingsPage";
import AdminAgentsPage from "../pages/admin/AdminAgentsPage";
import AdminPaymentsPage from "../pages/admin/AdminPaymentsPage";
import AdminRecoveryPage from "../pages/admin/AdminRecoveryPage";
import SyncLogsPage from "../pages/admin/SyncLogsPage";
import AdminBokunSyncPage from "../pages/admin/AdminBokunSyncPage";
import AdminBookingRequestsPage from "../pages/admin/AdminBookingRequestsPage";
import AdminBookingRequestDetailsPage from "../pages/admin/AdminBookingRequestDetailsPage";
import AdminOperationsPage from "../pages/admin/AdminOperationsPage";
import AdminBusinessIntelligencePage from "../pages/admin/AdminBusinessIntelligencePage";
import AdminDisasterRecoveryPage from "../pages/admin/AdminDisasterRecoveryPage";
import AdminSystemHealthPage from "../pages/admin/AdminSystemHealthPage";
import AdminPerformanceReviewPage from "../pages/admin/AdminPerformanceReviewPage";
import AdminProductionReadinessPage from "../pages/admin/AdminProductionReadinessPage";
import AdminBookingAccountingPage from "../pages/admin/AdminBookingAccountingPage";
import AdminBusinessAccountingPage from "../pages/admin/AdminBusinessAccountingPage";
import AdminChartOfAccountsPage from "../pages/admin/AdminChartOfAccountsPage";
import AdminCrmPage from "../pages/admin/AdminCrmPage";
import AdminGeneralLedgerPage from "../pages/admin/AdminGeneralLedgerPage";
import AdminReportCenterPage from "../pages/admin/AdminReportCenterPage";
import AdminAuditControlPage from "../pages/admin/AdminAuditControlPage";
import AdminDataQualityPage from "../pages/admin/AdminDataQualityPage";
import AdminOpsControlPage from "../pages/admin/AdminOpsControlPage";
import AdminUnavailablePage from "../components/admin/AdminUnavailablePage";
import AgentDashboardPage from "../pages/agent/AgentDashboardPage";
import AgentProductsPage from "../pages/agent/AgentProductsPage";
import AgentNewBookingPage from "../pages/agent/AgentNewBookingPage";
import AgentBookingsPage from "../pages/agent/AgentBookingsPage";
import AgentBookingDetailsPage from "../pages/agent/AgentBookingDetailsPage";
import AgentVoucherPage from "../pages/agent/AgentVoucherPage";
import AgentVouchersPage from "../pages/agent/AgentVouchersPage";
import AgentCommissionPage from "../pages/agent/AgentCommissionPage";
import AgentProfilePage from "../pages/agent/AgentProfilePage";
import AgentPayoutMethodPage from "../pages/agent/AgentPayoutMethodPage";
import AgentSettingsPage from "../pages/agent/AgentSettingsPage";
import AgentSupportPage from "../pages/agent/AgentSupportPage";
import AgentTourBookingPage from "../pages/agent/AgentTourBookingPage";
import AgentPendingApprovalPage from "../pages/agent/AgentPendingApprovalPage";
import AgentTermsPage from "../pages/agent/AgentTermsPage";
import AgentNotificationsPage from "../pages/agent/AgentNotificationsPage";
import AgentActivityPage from "../pages/agent/AgentActivityPage";
import AgentReportsPage from "../pages/agent/AgentReportsPage";
import AgentDraftsPage from "../pages/agent/AgentDraftsPage";
import LegalPage from "../pages/public/LegalPage";

const AgentLayout = () => <DashboardLayout portal="agent" />;

const LegacyBookingRequestRedirect = () => {
  const { requestId } = useParams();
  return <Navigate to={`/admin/operations/booking-requests/${requestId}`} replace />;
};

const AppRoutes = () => {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<HomePage />} />
        <Route path="/tours" element={<ToursPage />} />
        <Route path="/tours/:slug" element={<TourDetailsPage />} />
        <Route path="/booking/:slug" element={<BookingFlowPage />} />
        <Route path="/booking-confirmation/:reference" element={<BookingConfirmationPage />} />
        <Route path="/payment-success" element={<PaymentSuccessPage />} />
        <Route path="/payment-failure" element={<PaymentFailurePage />} />
        <Route path="/payment-processing" element={<PaymentProcessingPage />} />
        <Route path="/payment/checkout/:reference" element={<PaymentCheckoutPage />} />
        <Route path="/payment-status/:reference" element={<PaymentStatusPage />} />
        <Route path="/my-booking" element={<MyBookingPage />} />
        <Route path="/my-booking/:reference" element={<MyBookingPage />} />
        <Route path="/invoice/:bookingReference" element={<InvoiceDetailsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/agent-register" element={<AgentRegisterPage />} />
        <Route path="/privacy" element={<LegalPage />} />
        <Route path="/terms" element={<LegalPage />} />
      </Route>

      <Route
        element={
          <ProtectedRoute roles={["super_admin", "admin", "staff"]}>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/admin" element={<AdminDashboardPage />} />
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
        <Route path="/admin/booking-accounting/invoices" element={<AdminBookingAccountingPage />} />
        <Route path="/admin/booking-accounting/payments" element={<AdminPaymentsPage />} />
        <Route path="/admin/booking-accounting/refunds" element={<AdminBookingAccountingPage />} />
        <Route path="/admin/booking-accounting/expenses" element={<AdminBookingAccountingPage />} />
        <Route path="/admin/booking-accounting/cost-templates" element={<AdminBookingAccountingPage />} />
        <Route path="/admin/booking-accounting/cost-templates/new" element={<AdminBookingAccountingPage />} />
        <Route path="/admin/booking-accounting/cost-templates/:templateId" element={<AdminBookingAccountingPage />} />
        <Route path="/admin/booking-accounting/cost-templates/:templateId/edit" element={<AdminBookingAccountingPage />} />
        <Route path="/admin/booking-accounting/profitability" element={<AdminBookingAccountingPage />} />
        <Route path="/admin/booking-accounting/reconciliation" element={<AdminBookingAccountingPage />} />
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
        {[
          "/admin/business-accounting/journal-entries",
          "/admin/business-accounting/general-ledger",
          "/admin/business-accounting/trial-balance",
          "/admin/business-accounting/accounts-receivable",
          "/admin/business-accounting/accounts-payable",
          "/admin/business-accounting/cash-bank",
          "/admin/business-accounting/period-close",
          "/admin/business-accounting/balance-sheet",
          "/admin/business-accounting/profit-loss",
          "/admin/business-accounting/cash-flow",
          "/admin/business-accounting/fixed-assets",
          "/admin/business-accounting/accounting-reconciliation"
        ].map((path) => (
          <Route
            key={path}
            path={path}
            element={
              <ProtectedRoute permissions={[ADMIN_PERMISSIONS.GL_VIEW]}>
                <AdminGeneralLedgerPage />
              </ProtectedRoute>
            }
          />
        ))}
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

      <Route
        element={
          <ProtectedRoute roles={["agent"]}>
            <AgentLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/agent" element={<AgentDashboardPage />} />
        <Route path="/agent/pending" element={<AgentPendingApprovalPage />} />
        <Route path="/agent/terms" element={<AgentTermsPage />} />
        <Route path="/agent/products" element={<AgentProductsPage />} />
        <Route path="/agent/new-booking" element={<AgentNewBookingPage />} />
        <Route path="/agent/new-booking/:slug" element={<AgentTourBookingPage />} />
        <Route path="/agent/new-booking/:slug/checkout" element={<BookingFlowPage portal="agent" />} />
        <Route path="/agent/bookings" element={<AgentBookingsPage />} />
        <Route path="/agent/bookings/:reference" element={<AgentBookingDetailsPage />} />
        <Route path="/agent/bookings/:reference/voucher" element={<AgentVoucherPage />} />
        <Route path="/agent/vouchers" element={<AgentVouchersPage />} />
        <Route path="/agent/commissions" element={<AgentCommissionPage />} />
        <Route path="/agent/drafts" element={<AgentDraftsPage />} />
        <Route path="/agent/notifications" element={<AgentNotificationsPage />} />
        <Route path="/agent/activity" element={<AgentActivityPage />} />
        <Route path="/agent/reports" element={<AgentReportsPage />} />
        <Route path="/agent/profile" element={<AgentProfilePage />} />
        <Route path="/agent/payout-method" element={<AgentPayoutMethodPage />} />
        <Route path="/agent/settings" element={<AgentSettingsPage />} />
        <Route path="/agent/support" element={<AgentSupportPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default AppRoutes;
