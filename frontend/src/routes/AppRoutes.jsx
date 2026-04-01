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
import MyBookingPage from "../pages/public/MyBookingPage";
import InvoiceDetailsPage from "../pages/public/InvoiceDetailsPage";
import LoginPage from "../pages/public/LoginPage";
import AdminDashboardPage from "../pages/admin/AdminDashboardPage";
import AdminBookingsPage from "../pages/admin/AdminBookingsPage";
import SyncLogsPage from "../pages/admin/SyncLogsPage";
import AgentDashboardPage from "../pages/agent/AgentDashboardPage";
import AgentBookingsPage from "../pages/agent/AgentBookingsPage";

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
        <Route path="/my-booking" element={<MyBookingPage />} />
        <Route path="/my-booking/:reference" element={<MyBookingPage />} />
        <Route path="/invoice/:bookingReference" element={<InvoiceDetailsPage />} />
        <Route path="/login" element={<LoginPage />} />
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
        <Route path="/agent/bookings" element={<AgentBookingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default AppRoutes;
