import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import AdminSidebar from "../../components/admin/AdminSidebar";
import AdminTopBar from "../../components/admin/AdminTopBar";
import "../../components/admin/ui/adminUi.css";
import "../../components/admin/ui/admin-theme.css";
import "../../components/admin/ui/adminDark.css";
import useAuth from "../../hooks/useAuth";

const SIDEBAR_STATE_KEY = "zts.sidebar.collapsed";
const LEGACY_SIDEBAR_STATE_KEY = "zts_admin_sidebar_collapsed";

const THEME_KEY = "zts.admin.theme";

// "light" or "dark", remembered in this browser only (it works without storage too).
const loadThemePreference = () => {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
};

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
  const [theme, setTheme] = useState(loadThemePreference);
  const toggleTheme = () =>
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* storage blocked: the choice lasts for this visit */
      }
      return next;
    });

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  // Inter for the admin only (the public site keeps its own fonts): loaded once when the admin opens.
  useEffect(() => {
    if (typeof document === "undefined" || document.getElementById("adm-font-inter")) return;
    const link = document.createElement("link");
    link.id = "adm-font-inter";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
  }, []);

  // Modals and drawers render outside the shell, so the theme is also set on <html> while the admin is open.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    root.setAttribute("data-bs-theme", theme);
    root.setAttribute("data-admin-theme", theme);
    return () => {
      root.removeAttribute("data-bs-theme");
      root.removeAttribute("data-admin-theme");
    };
  }, [theme]);

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
      window.matchMedia("(max-width: 991.98px)").matches;

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
    <div
      className={`admin-platform-shell ${isSidebarCollapsed ? "is-sidebar-collapsed" : ""} ${isMobileMenuOpen ? "is-mobile-menu-open" : ""}`}
      data-admin-theme={theme}
      data-bs-theme={theme}
    >
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
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <main className="admin-platform-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
