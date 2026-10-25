import { lazy, Suspense } from "react";
import Loader from "../components/common/Loader";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import PublicLayout from "../layouts/PublicLayout";
import ProtectedRoute from "../components/common/ProtectedRoute";
import { ADMIN_PERMISSIONS } from "../config/adminNavigation";
import HomePage from "../pages/public/HomePage";
import ToursPage from "../pages/public/ToursPage";
import TourDetailsPage from "../pages/public/TourDetailsPage";
import AdminUnavailablePage from "../components/admin/AdminUnavailablePage";
import LegalPage from "../pages/public/LegalPage";
import ContactPage from "../pages/public/ContactPage";
import NotFoundPage from "../pages/public/NotFoundPage";

// Staff, agent and checkout pages load when opened, so the public pages stay small.
const DashboardLayout = lazy(() => import("../layouts/DashboardLayout"));
const AdminLayout = lazy(() => import("../layouts/admin/AdminLayout"));
const BookingFlowPage = lazy(() => import("../pages/public/BookingFlowPage"));
const CheckoutPage = lazy(() => import("../pages/public/CheckoutPage"));
const BookingConfirmationPage = lazy(() => import("../pages/public/BookingConfirmationPage"));
const PaymentSuccessPage = lazy(() => import("../pages/public/PaymentSuccessPage"));
const PaymentFailurePage = lazy(() => import("../pages/public/PaymentFailurePage"));
const PaymentStatusPage = lazy(() => import("../pages/public/PaymentStatusPage"));
const PaymentCheckoutPage = lazy(() => import("../pages/public/PaymentCheckoutPage"));
const PaymentFlowPage = lazy(() => import("../pages/public/PaymentFlowPage"));
const BookingConfirmedPage = lazy(() => import("../pages/public/BookingConfirmedPage"));
const MyBookingPage = lazy(() => import("../pages/public/MyBookingPage"));
const InvoiceDetailsPage = lazy(() => import("../pages/public/InvoiceDetailsPage"));
const AdminInvoicesPage = lazy(() => import("../pages/admin/AdminInvoicesPage"));
const LoginPage = lazy(() => import("../pages/public/LoginPage"));
const AgentRegisterPage = lazy(() => import("../pages/public/AgentRegisterPage"));
const AdminDashboardPage = lazy(() => import("../pages/admin/AdminDashboardPage"));
const AdminBookingsPage = lazy(() => import("../pages/admin/AdminBookingsPage"));
const AdminWebsiteToursPage = lazy(() => import("../pages/admin/AdminWebsiteToursPage"));
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
const AdminGeneralLedgerPage = lazy(() => import("../pages/admin/AdminGeneralLedgerPage"));
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
const AgentDashboardPage = lazy(() => import("../pages/agent/AgentDashboardPage"));
const AgentProductsPage = lazy(() => import("../pages/agent/AgentProductsPage"));
const AgentNewBookingPage = lazy(() => import("../pages/agent/AgentNewBookingPage"));
const AgentBookingsPage = lazy(() => import("../pages/agent/AgentBookingsPage"));
const AgentBookingDetailsPage = lazy(() => import("../pages/agent/AgentBookingDetailsPage"));
const AgentVoucherPage = lazy(() => import("../pages/agent/AgentVoucherPage"));
const AgentVouchersPage = lazy(() => import("../pages/agent/AgentVouchersPage"));
const AgentCommissionPage = lazy(() => import("../pages/agent/AgentCommissionPage"));
const AgentProfilePage = lazy(() => import("../pages/agent/AgentProfilePage"));
const AgentPayoutMethodPage = lazy(() => import("../pages/agent/AgentPayoutMethodPage"));
const AgentSettingsPage = lazy(() => import("../pages/agent/AgentSettingsPage"));
const AgentSupportPage = lazy(() => import("../pages/agent/AgentSupportPage"));
const AgentTourBookingPage = lazy(() => import("../pages/agent/AgentTourBookingPage"));
const AgentPendingApprovalPage = lazy(() => import("../pages/agent/AgentPendingApprovalPage"));
const AgentTermsPage = lazy(() => import("../pages/agent/AgentTermsPage"));
const AgentNotificationsPage = lazy(() => import("../pages/agent/AgentNotificationsPage"));
const AgentActivityPage = lazy(() => import("../pages/agent/AgentActivityPage"));
const AgentReportsPage = lazy(() => import("../pages/agent/AgentReportsPage"));
const AgentDraftsPage = lazy(() => import("../pages/agent/AgentDraftsPage"));

const AgentLayout = () => <DashboardLayout portal="agent" />;

const LegacyBookingRequestRedirect = () => {
  const { requestId } = useParams();
  return <Navigate to={`/admin/operations/booking-requests/${requestId}`} replace />;
};

const AppRoutes = () => {
  return (
    <Suspense fallback={<Loader message="Loading page..." />}><Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<HomePage />} />
        <Route path="/tours" element={<ToursPage />} />
        <Route path="/tours/:slug" element={<TourDetailsPage />} />
        <Route path="/booking/confirmed/:reference" element={<BookingConfirmedPage />} />
        <Route path="/booking/:slug" element={<CheckoutPage />} />
        <Route path="/booking-confirmation/:reference" element={<BookingConfirmationPage />} />
        <Route path="/payment-success" element={<PaymentSuccessPage />} />
        <Route path="/payment-failure" element={<PaymentFailurePage />} />
        <Route path="/payment-processing" element={<PaymentFlowPage />} />
        <Route path="/payment/checkout/:reference" element={<PaymentCheckoutPage />} />
        <Route path="/payment-status/:reference" element={<PaymentStatusPage />} />
        <Route path="/my-booking" element={<MyBookingPage />} />
        <Route path="/my-booking/:reference" element={<MyBookingPage />} />
        <Route path="/invoice/:bookingReference" element={<InvoiceDetailsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/agent-register" element={<AgentRegisterPage />} />
        <Route path="/privacy" element={<LegalPage />} />
        <Route path="/terms" element={<LegalPage />} />
        <Route path="/about" element={<LegalPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/faq" element={<LegalPage />} />
        <Route path="/cancellation-policy" element={<LegalPage />} />
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
        <Route path="/admin/operations/website-tours" element={<ProtectedRoute roles={["super_admin", "admin"]}><AdminWebsiteToursPage /></ProtectedRoute>} />
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

      <Route element={<PublicLayout />}>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes></Suspense>
  );
};

export default AppRoutes;
