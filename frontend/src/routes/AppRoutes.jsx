import { Navigate, Route, Routes } from "react-router-dom";
import PublicLayout from "../layouts/PublicLayout";
import DashboardLayout from "../layouts/DashboardLayout";
import ProtectedRoute from "../components/common/ProtectedRoute";
import HomePage from "../pages/public/HomePage";
import ToursPage from "../pages/public/ToursPage";
import TourDetailsPage from "../pages/public/TourDetailsPage";
import BookingFlowPage from "../pages/public/BookingFlowPage";
import BookingConfirmationPage from "../pages/public/BookingConfirmationPage";
import PaymentSuccessPage from "../pages/public/PaymentSuccessPage";
import PaymentFailurePage from "../pages/public/PaymentFailurePage";
import PaymentStatusPage from "../pages/public/PaymentStatusPage";
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

const AdminLayout = () => <DashboardLayout portal="admin" />;
const AgentLayout = () => <DashboardLayout portal="agent" />;

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
        <Route path="/payment/checkout/:reference" element={<PaymentCheckoutPage />} />
        <Route path="/payment-status/:reference" element={<PaymentStatusPage />} />
        <Route path="/my-booking" element={<MyBookingPage />} />
        <Route path="/my-booking/:reference" element={<MyBookingPage />} />
        <Route path="/invoice/:bookingReference" element={<InvoiceDetailsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/agent-register" element={<AgentRegisterPage />} />
      </Route>

      <Route
        element={
          <ProtectedRoute roles={["super_admin", "admin", "staff"]}>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/admin" element={<AdminDashboardPage />} />
        <Route path="/admin/bookings" element={<AdminBookingsPage />} />
        <Route path="/admin/agents" element={<AdminAgentsPage />} />
        <Route path="/admin/payments" element={<AdminPaymentsPage />} />
        <Route path="/admin/recovery" element={<AdminRecoveryPage />} />
        <Route path="/admin/sync-logs" element={<SyncLogsPage />} />
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
