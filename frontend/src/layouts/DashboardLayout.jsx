import { Container, Nav, Navbar } from "react-bootstrap";
import { Link, NavLink, Outlet } from "react-router-dom";
import useAuth from "../hooks/useAuth";

const DashboardLayout = ({ portal = "admin" }) => {
  const { user, logout } = useAuth();

  const links =
    portal === "agent"
      ? [
          { path: "/agent", label: "Dashboard" },
          { path: "/agent/bookings", label: "Bookings" }
        ]
      : [
          { path: "/admin", label: "Dashboard" },
          { path: "/admin/bookings", label: "Bookings" },
          { path: "/admin/sync-logs", label: "Sync Logs" }
        ];

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
