import { useEffect, useMemo, useState } from "react";
import { Button } from "react-bootstrap";
import { useLocation } from "react-router-dom";
import {
  BsBell,
  BsBoxArrowRight,
  BsCloudCheck,
  BsList,
  BsPersonCircle,
  BsSearch
} from "react-icons/bs";
import { fetchOperationsOverview } from "../../api/adminApi";
import { getAdminRouteMeta, roleLabel } from "../../config/adminNavigation";
import AdminBreadcrumbs from "./AdminBreadcrumbs";

const resolveSyncLabel = (status = "") => {
  if (status === "healthy") return "Bokun Sync OK";
  if (status === "critical") return "Sync Critical";
  if (status === "warning") return "Sync Warning";
  return "Sync Unknown";
};

const AdminTopBar = ({ user, collapsed, mobileOpen, onToggleSidebar, onLogout }) => {
  const location = useLocation();
  const routeMeta = useMemo(() => getAdminRouteMeta(location.pathname), [location.pathname]);
  const [overview, setOverview] = useState(null);
  const [syncError, setSyncError] = useState(false);

  useEffect(() => {
    let mounted = true;

    fetchOperationsOverview()
      .then((data) => {
        if (mounted) {
          setOverview(data);
          setSyncError(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setSyncError(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const alertCount = useMemo(() => {
    const queue = overview?.queue || {};
    return Number(queue.paidPendingSupplier || 0) +
      Number(queue.retriableFinalizations || 0) +
      Number(queue.failedEmails || 0) +
      Number(queue.openBookingRequests || 0);
  }, [overview]);

  const syncStatus = syncError ? "unknown" : overview?.status || "unknown";

  return (
    <header className="admin-platform-topbar">
      <div className="admin-platform-topbar-left">
        <button
          type="button"
          className="admin-platform-icon-button"
          aria-label={collapsed || mobileOpen ? "Show admin menu" : "Hide admin menu"}
          aria-expanded={mobileOpen || !collapsed}
          onClick={onToggleSidebar}
        >
          <BsList aria-hidden="true" />
        </button>
        <div className="admin-platform-page-title">
          <AdminBreadcrumbs items={routeMeta.breadcrumbs} />
          <h1>{routeMeta.label}</h1>
        </div>
      </div>

      <div className="admin-platform-topbar-center">
        <label className="admin-platform-search">
          <BsSearch aria-hidden="true" />
          <input type="search" placeholder="Global search" disabled aria-label="Global search" />
        </label>
      </div>

      <div className="admin-platform-topbar-actions">
        <span className={`admin-platform-sync-pill is-${syncStatus}`}>
          <BsCloudCheck aria-hidden="true" />
          {resolveSyncLabel(syncStatus)}
        </span>
        <span className="admin-platform-alert-pill">
          <BsBell aria-hidden="true" />
          Alerts {alertCount}
        </span>
        <span className="admin-platform-role-pill">
          <BsPersonCircle aria-hidden="true" />
          {roleLabel(user?.role)}
        </span>
        <Button type="button" variant="outline-secondary" size="sm" className="admin-platform-logout" onClick={onLogout}>
          <BsBoxArrowRight aria-hidden="true" />
          Logout
        </Button>
      </div>
    </header>
  );
};

export default AdminTopBar;
