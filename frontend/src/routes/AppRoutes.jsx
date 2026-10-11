import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import PublicLayout from "../layouts/PublicLayout";
import DashboardLayout from "../layouts/DashboardLayout";
import ProtectedRoute from "../components/common/ProtectedRoute";
import Loader from "../components/common/Loader";
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
import PasswordRecoveryPage from "../pages/public/PasswordRecoveryPage";
import AgentRegisterPage from "../pages/public/AgentRegisterPage";
import LegalPage from "../pages/public/LegalPage";
// The Back Office owns the admin pages; the website keeps /admin as a fallback that mounts the same routes.
import adminRoutes from "../../../backoffice/src/routes/AdminRoutes";
// Transfer System pages: independent of the tour (Bókun) booking flow.
const TransfersPage = lazy(() => import("../pages/public/TransfersPage"));
const TransferBookingStatusPage = lazy(() => import("../pages/public/TransferBookingStatusPage"));

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


const AppRoutes = () => {
  return (
    <Suspense fallback={<Loader message="Loading page..." />}>
    <Routes>
      <Route path="/forgot-password" element={<PasswordRecoveryPage key="forgot" />} />
      <Route path="/reset-password" element={<PasswordRecoveryPage key="reset" mode="reset" />} />
      <Route element={<PublicLayout />}>
        <Route index element={<HomePage />} />
        <Route path="/tours" element={<ToursPage />} />
        <Route path="/tours/:slug" element={<TourDetailsPage />} />
        <Route path="/transfers" element={<TransfersPage />} />
        <Route path="/transfers/booking/:reference" element={<TransferBookingStatusPage />} />
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

      {adminRoutes()}

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
    </Suspense>
  );
};

export default AppRoutes;
