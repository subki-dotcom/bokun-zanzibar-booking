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
import { fetchBokunSyncStatus, fetchOperationalAlerts, fetchOperationsOverview } from "../../api/adminApi";
import { getAdminRouteMeta, roleLabel } from "../../config/adminNavigation";
import { adminAlertCount, bokunSyncState } from "../../utils/adminStatus";
import AdminBreadcrumbs from "./AdminBreadcrumbs";

const AdminTopBar = ({ user, collapsed, mobileOpen, menuButtonRef, onToggleSidebar, onLogout }) => {
  const location = useLocation();
  const routeMeta = useMemo(() => getAdminRouteMeta(location.pathname), [location.pathname]);
  // Same sources and rules as the Dashboard (utils/adminStatus.js), so the two never disagree.
  const [status, setStatus] = useState({ sync: null, alerts: null, overview: null });

  useEffect(() => {
    let mounted = true;
    Promise.allSettled([fetchBokunSyncStatus(), fetchOperationalAlerts(), fetchOperationsOverview()]).then(([sync, alerts, overview]) => {
      if (!mounted) return;
      setStatus({
        sync: sync.status === "fulfilled" ? sync.value : null,
        alerts: alerts.status === "fulfilled" ? alerts.value : null,
        overview: overview.status === "fulfilled" ? overview.value : null
      });
    });
    return () => {
      mounted = false;
    };
  }, []);

  const alertCount = adminAlertCount({ operationalAlerts: status.alerts, operationsOverview: status.overview });
  const sync = bokunSyncState(status.sync);
  const syncStatus = sync.status;

  return (
    <header className="admin-platform-topbar">
      <div className="admin-platform-topbar-left">
        <button
          type="button"
          className="admin-platform-icon-button"
          aria-label={collapsed || mobileOpen ? "Show admin menu" : "Hide admin menu"}
          aria-expanded={mobileOpen || !collapsed}
          aria-controls="admin-platform-sidebar"
          ref={menuButtonRef}
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
        <span className={`admin-platform-sync-pill is-${syncStatus}`} title={sync.detail}>
          <BsCloudCheck aria-hidden="true" />
          {sync.label}
        </span>
        <span className="admin-platform-alert-pill" title="Paid bookings waiting for the supplier, failed payments, failed emails, finalizations to retry and open booking requests">
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
