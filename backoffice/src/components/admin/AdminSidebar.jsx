import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BsBoxArrowRight,
  BsChevronDown,
  BsChevronRight,
  BsMoon,
  BsXLg
} from "react-icons/bs";
import {
  filterAdminNavigation,
  hasActiveAdminChild,
  isAdminNavItemActive,
  roleLabel
} from "../../config/adminNavigation";

const SECTION_STATE_KEY = "riser_admin_sidebar_sections";

const loadOpenSections = () => {
  try {
    return JSON.parse(localStorage.getItem(SECTION_STATE_KEY) || "{}");
  } catch (_error) {
    return {};
  }
};

const getInitials = (user) => {
  const source = user?.fullName || user?.name || user?.email || "Super Admin";
  const parts = String(source)
    .split(/[\s@._-]+/)
    .filter(Boolean);
  const initials = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2);
  return initials.toUpperCase();
};

const PlannedBadge = () => <span className="admin-platform-nav-badge">Soon</span>;

const SidebarBrand = ({ onNavigate, onClose }) => (
  <div className="admin-platform-brand-wrap">
    <Link to="/admin" className="admin-platform-brand" onClick={onNavigate} aria-label="Riser admin dashboard">
      <span className="admin-platform-brand-mark">R</span>
      <span className="admin-platform-brand-copy">
        <strong>Riser</strong>
        <small>Business Platform</small>
      </span>
    </Link>
    <button
      type="button"
      className="admin-platform-mobile-close"
      aria-label="Close admin menu"
      onClick={onClose}
    >
      <BsXLg aria-hidden="true" />
    </button>
  </div>
);

const SidebarProfile = ({ user, collapsed }) => (
  <button
    type="button"
    className="admin-platform-user-mini"
    aria-label={`Admin profile: ${roleLabel(user?.role)}`}
    data-tooltip={roleLabel(user?.role)}
  >
    <span className="admin-platform-avatar">{getInitials(user)}</span>
    <span className="admin-platform-user-info">
      <strong>{user?.fullName || user?.email || "Super Admin"}</strong>
      <small>{user?.role || "super_admin"}</small>
    </span>
    <BsChevronDown className="admin-platform-user-chevron" aria-hidden="true" />
  </button>
);

const SidebarItem = ({ item, depth = 0, pathname, collapsed, onNavigate, openSections, onToggleSection }) => {
  const hasChildren = Boolean(item.children?.length);
  const active = isAdminNavItemActive(item, pathname);
  const childActive = hasActiveAdminChild(item, pathname);
  const open = openSections[item.id] ?? childActive ?? depth === 0;
  const Icon = item.icon;
  const isPlanned = item.status === "planned";
  const tooltip = item.label;

  if (hasChildren) {
    return (
      <div className={`admin-platform-nav-nested depth-${depth} ${childActive ? "is-active" : ""}`}>
        <button
          type="button"
          className="admin-platform-nav-trigger"
          aria-expanded={open}
          aria-label={item.label}
          data-tooltip={tooltip}
          onClick={() => onToggleSection(item.id)}
        >
          {Icon ? <Icon aria-hidden="true" /> : null}
          <span>{item.label}</span>
          {!collapsed ? open ? <BsChevronDown aria-hidden="true" /> : <BsChevronRight aria-hidden="true" /> : null}
        </button>

        {open && !collapsed ? (
          <div className="admin-platform-nav-children">
            {item.children.map((child) => (
              <SidebarItem
                key={child.id}
                item={child}
                depth={depth + 1}
                pathname={pathname}
                collapsed={collapsed}
                onNavigate={onNavigate}
                openSections={openSections}
                onToggleSection={onToggleSection}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (isPlanned) {
    return (
      <div
        className={`admin-platform-nav-link is-planned depth-${depth}`}
        aria-disabled="true"
        data-tooltip={tooltip ? `${item.label} - not available yet` : undefined}
      >
        {Icon ? <Icon aria-hidden="true" /> : null}
        <span>{item.label}</span>
        {!collapsed ? <PlannedBadge /> : null}
      </div>
    );
  }

  return (
    <Link
      to={item.path}
      className={`admin-platform-nav-link depth-${depth} ${active ? "active" : ""}`}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      data-tooltip={tooltip}
      onClick={onNavigate}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span>{item.label}</span>
      <BsChevronRight className="admin-platform-nav-row-arrow" aria-hidden="true" />
    </Link>
  );
};

const SidebarSection = ({ section, pathname, collapsed, onNavigate, openSections, onToggleSection }) => (
  <section className="admin-platform-nav-section" aria-label={section.label}>
    <div className="admin-platform-nav-section-label">{section.label}</div>
    <div className="admin-platform-nav-section-items">
      {(section.children || []).map((item) => (
        <SidebarItem
          key={item.id}
          item={item}
          pathname={pathname}
          collapsed={collapsed}
          onNavigate={onNavigate}
          openSections={openSections}
          onToggleSection={onToggleSection}
        />
      ))}
    </div>
  </section>
);

const SidebarFooter = ({ collapsed, onLogout }) => (
  <footer className="admin-platform-sidebar-footer">
    <button
      type="button"
      className="admin-platform-sidebar-footer-action"
      aria-label="Dark mode preference is not configured"
      aria-disabled="true"
      data-tooltip="Dark Mode"
      title="Dark mode will follow the admin theme system when it is configured."
    >
      <BsMoon aria-hidden="true" />
      <span>Dark Mode</span>
    </button>
    <button
      type="button"
      className="admin-platform-sidebar-footer-action"
      aria-label="Logout"
      data-tooltip="Logout"
      onClick={onLogout}
    >
      <BsBoxArrowRight aria-hidden="true" />
      <span>Logout</span>
    </button>
  </footer>
);

const AdminSidebar = ({ user, collapsed, mobileOpen, onNavigate, onClose, onLogout }) => {
  const location = useLocation();
  const navigation = useMemo(() => filterAdminNavigation(undefined, user), [user]);
  const [openSections, setOpenSections] = useState(() => ({
    ...loadOpenSections()
  }));

  useEffect(() => {
    const activeSections = {};
    const markActive = (items = []) => {
      items.forEach((item) => {
        if (hasActiveAdminChild(item, location.pathname)) {
          activeSections[item.id] = true;
        }
        if (item.children) markActive(item.children);
      });
    };
    markActive(navigation);

    if (Object.keys(activeSections).length) {
      setOpenSections((current) => ({ ...current, ...activeSections }));
    }
  }, [location.pathname, navigation]);

  const toggleSection = (id) => {
    setOpenSections((current) => {
      const next = { ...current, [id]: !current[id] };
      localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(next));
      return next;
    });
  };

  return (
    <aside
      id="admin-platform-sidebar"
      className={`admin-platform-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}
      aria-label="Admin navigation"
      aria-hidden={!mobileOpen ? undefined : false}
    >
      <SidebarBrand onNavigate={onNavigate} onClose={onClose} />
      <SidebarProfile user={user} collapsed={collapsed} />

      <nav className="admin-platform-nav" aria-label="Admin navigation">
        {navigation.map((section) => (
          <SidebarSection
            key={section.id}
            section={section}
            pathname={location.pathname}
            collapsed={collapsed}
            onNavigate={onNavigate}
            openSections={openSections}
            onToggleSection={toggleSection}
          />
        ))}
      </nav>

      <SidebarFooter collapsed={collapsed} onLogout={onLogout} />
    </aside>
  );
};

export default AdminSidebar;
