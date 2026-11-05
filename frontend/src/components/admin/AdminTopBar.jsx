import { useEffect, useMemo, useRef, useState } from "react";
import { Dropdown } from "react-bootstrap";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BsBell, BsBoxArrowRight, BsCloudCheck, BsGear, BsList, BsMoon, BsSearch, BsSun } from "react-icons/bs";
import { fetchBokunSyncStatus, fetchOperationalAlerts, fetchOperationsOverview } from "../../api/adminApi";
import { filterAdminNavigation, getAdminRouteMeta, roleLabel } from "../../config/adminNavigation";
import { adminAlertCount, bokunSyncState } from "../../utils/adminStatus";
import AdminBreadcrumbs from "./AdminBreadcrumbs";

const initialsOf = (user) => {
  const source = user?.fullName || user?.name || user?.email || "Admin";
  const parts = String(source).split(/[\s@._-]+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2)).toUpperCase();
};

// The pages this user can open, for the search box ("Ctrl+K").
const flattenPages = (items = [], section = "") =>
  items.flatMap((item) => [
    ...(item.path ? [{ id: item.id, label: item.label, path: item.path, section }] : []),
    ...flattenPages(item.children || [], item.path ? section : item.label || section)
  ]);

const PageSearch = ({ user }) => {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const pages = useMemo(() => flattenPages(filterAdminNavigation(undefined, user)), [user]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages.slice(0, 8);
    return pages.filter((page) => `${page.label} ${page.section}`.toLowerCase().includes(q)).slice(0, 8);
  }, [pages, query]);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const go = (page) => {
    if (!page) return;
    navigate(page.path);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="adm-search" role="search">
      <label className="adm-search-field">
        <BsSearch aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Search pages"
          aria-label="Search admin pages"
          aria-expanded={open}
          aria-controls="adm-search-results"
          aria-autocomplete="list"
          role="combobox"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
        />
        <kbd aria-hidden="true">Ctrl K</kbd>
      </label>
      {open && results.length ? (
        <ul className="adm-search-results" id="adm-search-results" role="listbox" aria-label="Pages">
          {results.map((page, index) => (
            <li key={page.id} role="option" aria-selected={index === active}>
              <button type="button" className={index === active ? "is-active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => go(page)}>
                <span>{page.label}</span>
                {page.section ? <small>{page.section}</small> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

const AdminTopBar = ({ user, collapsed, mobileOpen, menuButtonRef, onToggleSidebar, onLogout, theme = "light", onToggleTheme }) => {
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

  // Browser tab: "Page · Admin".
  useEffect(() => {
    if (typeof document !== "undefined") document.title = `${routeMeta.label || "Admin"} · Admin`;
  }, [routeMeta.label]);

  const alertCount = adminAlertCount({ operationalAlerts: status.alerts, operationsOverview: status.overview });
  const sync = bokunSyncState(status.sync);

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
        </div>
      </div>

      <div className="admin-platform-topbar-center">
        <PageSearch user={user} />
      </div>

      <div className="admin-platform-topbar-actions">
        <span className={`admin-platform-sync-pill is-${sync.status}`} title={sync.detail}>
          <BsCloudCheck aria-hidden="true" />
          <span className="adm-hide-sm">{sync.label}</span>
        </span>
        <Link
          to="/admin/operations/recovery"
          className="adm-icon-button adm-bell"
          aria-label={`${alertCount} open alerts`}
          title="Paid bookings waiting for the supplier, failed payments, failed emails, finalizations to retry and open booking requests"
        >
          <BsBell aria-hidden="true" />
          {alertCount ? <span className="adm-bell-count">{alertCount > 99 ? "99+" : alertCount}</span> : null}
        </Link>
        <Dropdown align="end" className="adm-user-menu">
          <Dropdown.Toggle as="button" type="button" className="adm-avatar-button" aria-label={`Account menu for ${user?.fullName || user?.email || "admin"}`}>
            <span className="adm-avatar">{initialsOf(user)}</span>
          </Dropdown.Toggle>
          <Dropdown.Menu className="adm-user-dropdown">
            <div className="adm-user-dropdown-head">
              <strong>{user?.fullName || user?.email || "Admin"}</strong>
              <small>{roleLabel(user?.role)}</small>
            </div>
            <Dropdown.Divider />
            <Dropdown.Item as={Link} to="/admin/settings">
              <BsGear aria-hidden="true" /> Settings
            </Dropdown.Item>
            {onToggleTheme ? (
              <Dropdown.Item as="button" type="button" onClick={onToggleTheme}>
                {theme === "dark" ? <BsSun aria-hidden="true" /> : <BsMoon aria-hidden="true" />} {theme === "dark" ? "Light mode" : "Dark mode"}
              </Dropdown.Item>
            ) : null}
            <Dropdown.Divider />
            <Dropdown.Item as="button" type="button" onClick={onLogout}>
              <BsBoxArrowRight aria-hidden="true" /> Logout
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      </div>
    </header>
  );
};

export default AdminTopBar;
