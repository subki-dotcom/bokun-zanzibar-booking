import { Container, Nav, Navbar } from "react-bootstrap";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import Footer from "../components/common/footer/Footer";
import FloatingWhatsAppButton from "../components/common/footer/FloatingWhatsAppButton";

const PublicLayout = () => {
  const location = useLocation();
  const isCheckoutRoute = /^(\/booking\/|\/payment\/checkout\/|\/payment-(success|failure)\/|\/payment-status\/)/.test(
    location.pathname
  );

  return (
    <div className={`app-shell ${isCheckoutRoute ? "is-checkout-route" : ""}`.trim()}>
      <Navbar expand="lg" className="public-nav py-3">
        <Container>
          <Navbar.Brand as={Link} to="/" className="brand-mark fs-4">
            Zanzibar Premium Experiences
          </Navbar.Brand>
          <Navbar.Toggle aria-controls="public-nav-collapse" className="public-nav-toggle" />
          <Navbar.Collapse id="public-nav-collapse">
            <Nav className="ms-auto gap-2 public-nav-links">
              <Nav.Link as={NavLink} to="/tours" className="nav-pill-link">
                Tours
              </Nav.Link>
              <Nav.Link as={NavLink} to="/my-booking" className="nav-pill-link">
                My Booking
              </Nav.Link>
              <Nav.Link as={NavLink} to="/login" className="nav-pill-link">
                Agent/Admin Login
              </Nav.Link>
            </Nav>
          </Navbar.Collapse>
        </Container>
      </Navbar>

      <main className="app-main-content">
        <Outlet />
      </main>
      <Footer />
      <FloatingWhatsAppButton href="https://wa.me/255777123456" />
    </div>
  );
};

export default PublicLayout;
