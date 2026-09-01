import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import AdminSidebar from "../../components/admin/AdminSidebar";
import AdminTopBar from "../../components/admin/AdminTopBar";
import useAuth from "../../hooks/useAuth";

const SIDEBAR_STATE_KEY = "riser.sidebar.collapsed";
const LEGACY_SIDEBAR_STATE_KEY = "riser_admin_sidebar_collapsed";

const loadSidebarPreference = () => {
  const stored = localStorage.getItem(SIDEBAR_STATE_KEY) ?? localStorage.getItem(LEGACY_SIDEBAR_STATE_KEY);
  return stored === "true";
};

const AdminLayout = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const menuButtonRef = useRef(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(loadSidebarPreference);
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

  useEffect(() => {
    if (!isMobileMenuOpen || typeof document === "undefined") return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsMobileMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    const focusCloseButton = () => {
      document.querySelector(".admin-platform-mobile-close")?.focus();
    };

    document.addEventListener("keydown", handleKeyDown);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(focusCloseButton);
    } else {
      focusCloseButton();
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
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
        onClose={() => {
          setIsMobileMenuOpen(false);
          menuButtonRef.current?.focus();
        }}
        onLogout={logout}
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
          menuButtonRef={menuButtonRef}
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
