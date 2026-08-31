import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import AdminSidebar from "../../components/admin/AdminSidebar";
import AdminTopBar from "../../components/admin/AdminTopBar";
import useAuth from "../../hooks/useAuth";

const SIDEBAR_STATE_KEY = "riser_admin_sidebar_collapsed";

const AdminLayout = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_STATE_KEY) === "true");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = isMobileMenuOpen ? "hidden" : previousOverflow;

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileMenuOpen]);

  const handleToggleSidebar = () => {
    const isMobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 900px)").matches;

    if (isMobile) {
      setIsMobileMenuOpen((current) => !current);
      return;
    }

    setIsSidebarCollapsed((current) => {
      const next = !current;
      localStorage.setItem(SIDEBAR_STATE_KEY, String(next));
      return next;
    });
  };

  return (
    <div className={`admin-platform-shell ${isSidebarCollapsed ? "is-sidebar-collapsed" : ""} ${isMobileMenuOpen ? "is-mobile-menu-open" : ""}`}>
      <AdminSidebar
        user={user}
        collapsed={isSidebarCollapsed}
        mobileOpen={isMobileMenuOpen}
        onNavigate={() => setIsMobileMenuOpen(false)}
      />
      <button
        type="button"
        className="admin-platform-sidebar-overlay"
        aria-label="Close admin menu"
        onClick={() => setIsMobileMenuOpen(false)}
      />

      <div className="admin-platform-main">
        <AdminTopBar
          user={user}
          collapsed={isSidebarCollapsed}
          mobileOpen={isMobileMenuOpen}
          onToggleSidebar={handleToggleSidebar}
          onLogout={logout}
        />
        <main className="admin-platform-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
