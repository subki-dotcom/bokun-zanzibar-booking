import { Navigate, useLocation } from "react-router-dom";
import Loader from "./Loader";
import useAuth from "../../hooks/useAuth";

// redirectTo: where a signed-in user without the role or permission is sent (the website's /admin sends them to
// their own admin home rather than the public home page).
const ProtectedRoute = ({ children, roles = [], permissions = [], redirectTo = "/" }) => {
  const { isAuthenticated, user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <Loader message="Loading session..." />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (roles.length && !roles.includes(user?.role)) {
    return <Navigate to={redirectTo} replace />;
  }

  if (permissions.length) {
    const userPermissions = Array.isArray(user?.permissions) ? user.permissions : [];
    if (!permissions.some((permission) => userPermissions.includes(permission))) {
      return <Navigate to={redirectTo} replace />;
    }
  }

  if (user?.role === "agent") {
    const path = location.pathname;
    const approvalStatus = String(user?.approvalStatus || "approved");
    const pendingAllowedPaths = ["/agent/pending", "/agent/support"];

    if (approvalStatus !== "approved" && !pendingAllowedPaths.includes(path)) {
      return <Navigate to="/agent/pending" replace />;
    }

    if (approvalStatus === "approved" && !user?.termsAcceptedAt && path !== "/agent/terms") {
      return <Navigate to="/agent/terms" replace />;
    }
  }

  return children;
};

export default ProtectedRoute;
