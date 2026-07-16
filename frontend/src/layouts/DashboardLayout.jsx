import { useState } from "react";
import { Container, Nav, Navbar } from "react-bootstrap";
import { Link, NavLink, Outlet } from "react-router-dom";
import {
  BsBell,
  BsBoxArrowRight,
  BsBriefcase,
  BsCalendar2Check,
  BsCalendar3,
  BsCashCoin,
  BsClipboardCheck,
  BsGear,
  BsGlobe2,
  BsGrid1X2,
  BsHeadset,
  BsList,
  BsPerson,
  BsSearch,
  BsWallet2,
  BsWhatsapp
} from "react-icons/bs";
import useAuth from "../hooks/useAuth";

const DashboardLayout = ({ portal = "admin" }) => {
  const { user, logout } = useAuth();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const links =
    portal === "agent"
      ? [
          { path: "/agent", label: "Dashboard" },
          { path: "/agent/products", label: "Products / Tours" },
          { path: "/agent/new-booking", label: "New Booking" },
          { path: "/agent/bookings", label: "My Bookings" },
          { path: "/agent/vouchers", label: "Vouchers" },
          { path: "/agent/commissions", label: "Commission" },
          { path: "/agent/profile", label: "Profile" },
          { path: "/agent/payout-method", label: "Payout" },
          { path: "/agent/settings", label: "Settings" },
          { path: "/agent/support", label: "Support" }
        ]
      : [
          { path: "/admin", label: "Dashboard" },
          { path: "/admin/bookings", label: "Bookings" },
          { path: "/admin/agents", label: "Agents" },
          { path: "/admin/payments", label: "Payments" },
          { path: "/admin/booking-requests", label: "Booking Requests" },
          { path: "/admin/recovery", label: "Recovery" },
          { path: "/admin/operations", label: "Operations" },
          { path: "/admin/sync-logs", label: "Sync Logs" }
        ];

  if (portal === "agent") {
    const agentLinks = [
      { path: "/agent", label: "Dashboard", icon: <BsGrid1X2 /> },
      { path: "/agent/products", label: "Products / Tours", icon: <BsBriefcase /> },
      { path: "/agent/new-booking", label: "New Booking", icon: <BsCalendar2Check /> },
      { path: "/agent/bookings", label: "My Bookings", icon: <BsCalendar3 /> },
      { path: "/agent/vouchers", label: "Vouchers", icon: <BsClipboardCheck /> },
      { path: "/agent/commissions", label: "Commission / Statement", icon: <BsCashCoin /> },
      { path: "/agent/drafts", label: "Drafts", icon: <BsClipboardCheck /> },
      { path: "/agent/reports", label: "Reports", icon: <BsGrid1X2 /> },
      { path: "/agent/activity", label: "Activity Log", icon: <BsCalendar3 /> },
      { path: "/agent/profile", label: "Profile", icon: <BsPerson /> },
      { path: "/agent/payout-method", label: "Payout Method", icon: <BsWallet2 /> },
      { path: "/agent/settings", label: "Settings", icon: <BsGear /> },
      { path: "/agent/support", label: "Support", icon: <BsHeadset /> }
    ];

    const handleMenuToggle = () => {
      const isMobile =
        typeof window !== "undefined" &&
        window.matchMedia("(max-width: 768px)").matches;

      if (isMobile) {
        setIsMobileMenuOpen((prev) => !prev);
        return;
      }

      setIsSidebarCollapsed((prev) => !prev);
    };

    const closeMobileMenu = () => {
      setIsMobileMenuOpen(false);
    };

    return (
      <div className={`agent-shell ${isSidebarCollapsed ? "is-sidebar-collapsed" : ""} ${isMobileMenuOpen ? "is-mobile-menu-open" : ""}`}>
        <aside className="agent-sidebar">
          <Link to="/agent" className="agent-brand" onClick={closeMobileMenu}>
            <span className="agent-brand-mark">R</span>
            <span>
              <strong>RISER</strong>
              <small>TOURS & SAFARIS</small>
            </span>
          </Link>

          <div className="agent-profile-mini">
            <div className="agent-avatar">{String(user?.fullName || user?.email || "A").slice(0, 1).toUpperCase()}</div>
            <strong>{user?.fullName || "Riser Agent"}</strong>
            <small>{user?.companyName || "Riser Agent Portal"}</small>
            <span className="agent-online-dot">Online</span>
          </div>

          <Nav className="agent-side-nav">
            {agentLinks.map((item) => (
              <Nav.Link as={NavLink} key={item.path} to={item.path} end={item.path === "/agent"} className="agent-side-link" onClick={closeMobileMenu}>
                {item.icon}
                <span>{item.label}</span>
              </Nav.Link>
            ))}
          </Nav>

          <button type="button" className="agent-side-logout" onClick={logout}>
            <BsBoxArrowRight />
            <span>Logout</span>
          </button>
        </aside>
        <button type="button" className="agent-sidebar-overlay" aria-label="Close menu" onClick={closeMobileMenu} />

        <div className="agent-main">
          <header className="agent-topbar">
            <div className="agent-topbar-title">
              <button
                type="button"
                className="agent-icon-button"
                aria-label={isSidebarCollapsed || isMobileMenuOpen ? "Show menu" : "Hide menu"}
                aria-expanded={isMobileMenuOpen || !isSidebarCollapsed}
                onClick={handleMenuToggle}
              >
                <BsList />
              </button>
              <span>Agent Portal</span>
            </div>
            <div className="agent-topbar-search">
              <BsSearch />
              <input placeholder="Search tours, bookings..." />
            </div>
            <div className="agent-topbar-actions">
              <Link to="/agent/notifications" className="agent-icon-button has-badge" aria-label="Notifications">
                <BsBell />
                <span>5</span>
              </Link>
              <a className="agent-icon-button is-whatsapp" href="https://wa.me/255778775044" target="_blank" rel="noreferrer" aria-label="WhatsApp support">
                <BsWhatsapp />
              </a>
              <button type="button" className="agent-language-button">
                <BsGlobe2 />
                EN
              </button>
            </div>
          </header>

          <main className="agent-content">
            <Outlet />
            <footer className="agent-footer">
              <span>(c) 2025 Riser Tours & Safaris. All rights reserved.</span>
              <span>Agent Portal v1.0.0</span>
            </footer>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Navbar className="hero-band dashboard-nav py-3" expand="lg">
        <Container>
          <Navbar.Brand as={Link} to="/" className="text-white portal-brand">
            Zanzibar Operations Portal
          </Navbar.Brand>
          <Navbar.Toggle aria-controls="dashboard-nav" className="public-nav-toggle" />
          <Navbar.Collapse id="dashboard-nav">
            <Nav className="me-auto ms-3 gap-2 dashboard-nav-links">
              {links.map((item) => (
                <Nav.Link as={NavLink} key={item.path} to={item.path} className="portal-nav-link">
                  {item.label}
                </Nav.Link>
              ))}
            </Nav>
            <div className="text-white d-flex align-items-center gap-3 portal-user">
              <span className="small">{user?.fullName || user?.email}</span>
              <button type="button" className="btn btn-sm btn-outline-light portal-logout" onClick={logout}>
                Logout
              </button>
            </div>
          </Navbar.Collapse>
        </Container>
      </Navbar>

      <main className="app-main-content dashboard-main-content">
        <Container className="py-4 portal-content-container">
          <Outlet />
        </Container>
      </main>
    </div>
  );
};

export default DashboardLayout;
