import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import AdminLayout from "../layout/AdminLayout";
import LoginPage from "../pages/LoginPage";
import { Loading, RequirePermission } from "../components/ui";
import { P } from "../lib/permissions";

const DashboardPage = lazy(() => import("../pages/DashboardPage"));
const BookingsPage = lazy(() => import("../pages/BookingsPage"));
const BookingDetailPage = lazy(() => import("../pages/BookingDetailPage"));
const ZonesPage = lazy(() => import("../pages/ZonesPage"));
const LocationsPage = lazy(() => import("../pages/LocationsPage"));
const PopularRoutesPage = lazy(() => import("../pages/PopularRoutesPage"));
const RoutesPage = lazy(() => import("../pages/RoutesPage"));
const RatesPage = lazy(() => import("../pages/RatesPage"));
const SettingsPage = lazy(() => import("../pages/SettingsPage"));
const UsersPage = lazy(() => import("../pages/UsersPage"));
const AuditLogPage = lazy(() => import("../pages/AuditLogPage"));
const DispatchPage = lazy(() => import("../pages/DispatchPage"));
const DriversPage = lazy(() => import("../pages/DriversPage"));
const VehiclesPage = lazy(() => import("../pages/VehiclesPage"));

const RequireAuth = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
};

const guarded = (permission, Page) => (
  <RequirePermission permission={permission}>
    <Page />
  </RequirePermission>
);

// Dashboard is the landing page for roles that can see bookings; others land on their first allowed page.
const Home = () => {
  const { user } = useAuth();
  if (user.permissions.includes(P.BOOKINGS_VIEW)) return <DashboardPage />;
  if (user.permissions.includes(P.FLEET_VIEW)) return <Navigate to="/dispatch" replace />;
  if (user.permissions.includes(P.PRICING_VIEW)) return <Navigate to="/pricing/rates" replace />;
  return <RequirePermission permission={P.BOOKINGS_VIEW}><DashboardPage /></RequirePermission>;
};

const AppRoutes = () => (
  <Suspense fallback={<Loading label="Loading page…" />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="/bookings" element={guarded(P.BOOKINGS_VIEW, BookingsPage)} />
        <Route path="/bookings/:bookingId" element={guarded(P.BOOKINGS_VIEW, BookingDetailPage)} />
        <Route path="/dispatch" element={guarded(P.FLEET_VIEW, DispatchPage)} />
        <Route path="/fleet/drivers" element={guarded(P.FLEET_VIEW, DriversPage)} />
        <Route path="/fleet/vehicles" element={guarded(P.FLEET_VIEW, VehiclesPage)} />
        <Route path="/pricing/zones" element={guarded(P.PRICING_VIEW, ZonesPage)} />
        <Route path="/pricing/locations" element={guarded(P.PRICING_VIEW, LocationsPage)} />
        <Route path="/pricing/routes" element={guarded(P.PRICING_VIEW, RoutesPage)} />
        <Route path="/pricing/rates" element={guarded(P.PRICING_VIEW, RatesPage)} />
        <Route path="/pricing/popular-routes" element={guarded(P.PRICING_VIEW, PopularRoutesPage)} />
        <Route path="/pricing/settings" element={guarded(P.PRICING_VIEW, SettingsPage)} />
        <Route path="/users" element={guarded(P.USERS_MANAGE, UsersPage)} />
        <Route path="/audit" element={guarded(P.AUDIT_VIEW, AuditLogPage)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  </Suspense>
);

export default AppRoutes;
