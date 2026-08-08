import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { BsChevronDown, BsChevronRight } from "react-icons/bs";
import {
  filterAdminNavigation,
  hasActiveAdminChild,
  isAdminNavItemActive
} from "../../config/adminNavigation";

const SECTION_STATE_KEY = "riser_admin_sidebar_sections";

const loadOpenSections = () => {
  try {
    return JSON.parse(localStorage.getItem(SECTION_STATE_KEY) || "{}");
  } catch (_error) {
    return {};
  }
};

const PlannedBadge = () => <span className="admin-platform-nav-badge">Soon</span>;

const AdminSidebarItem = ({ item, depth = 0, pathname, collapsed, onNavigate, openSections, onToggleSection }) => {
  const hasChildren = Boolean(item.children?.length);
  const active = isAdminNavItemActive(item, pathname);
  const childActive = hasActiveAdminChild(item, pathname);
  const open = openSections[item.id] ?? childActive ?? depth === 0;
  const Icon = item.icon;
  const isPlanned = item.status === "planned";

  if (hasChildren) {
    return (
      <div className={`admin-platform-nav-group depth-${depth} ${childActive ? "is-active" : ""}`}>
        <button
          type="button"
          className="admin-platform-nav-trigger"
          aria-expanded={open}
          onClick={() => onToggleSection(item.id)}
          title={collapsed ? item.label : undefined}
        >
          {Icon ? <Icon aria-hidden="true" /> : null}
          <span>{item.label}</span>
          {!collapsed ? open ? <BsChevronDown aria-hidden="true" /> : <BsChevronRight aria-hidden="true" /> : null}
        </button>

        {open && !collapsed ? (
          <div className="admin-platform-nav-children">
            {item.children.map((child) => (
              <AdminSidebarItem
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
        title={collapsed ? `${item.label} - not available yet` : undefined}
        aria-disabled="true"
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
      title={collapsed ? item.label : undefined}
      onClick={onNavigate}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span>{item.label}</span>
    </Link>
  );
};

const AdminSidebar = ({ user, collapsed, mobileOpen, onNavigate }) => {
  const location = useLocation();
  const navigation = useMemo(() => filterAdminNavigation(undefined, user?.role), [user?.role]);
  const [openSections, setOpenSections] = useState(() => ({
    operations: true,
    "booking-accounting": true,
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
    <aside className={`admin-platform-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}>
      <Link to="/admin" className="admin-platform-brand" onClick={onNavigate}>
        <span className="admin-platform-brand-mark">R</span>
        <span>
          <strong>Riser Business Platform</strong>
          <small>Admin System</small>
        </span>
      </Link>

      <div className="admin-platform-user-mini">
        <div className="admin-platform-avatar">{String(user?.fullName || user?.email || "A").slice(0, 1).toUpperCase()}</div>
        <div>
          <strong>{user?.fullName || user?.email || "Admin"}</strong>
          <small>{user?.role || "admin"}</small>
        </div>
      </div>

      <nav className="admin-platform-nav" aria-label="Admin navigation">
        {navigation.map((item) => (
          <AdminSidebarItem
            key={item.id}
            item={item}
            pathname={location.pathname}
            collapsed={collapsed}
            onNavigate={onNavigate}
            openSections={openSections}
            onToggleSection={toggleSection}
          />
        ))}
      </nav>
    </aside>
  );
};

export default AdminSidebar;
