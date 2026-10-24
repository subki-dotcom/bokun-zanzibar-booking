import { Container, Nav, Navbar } from "react-bootstrap";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Suspense, useEffect } from "react";
import Footer from "../components/common/footer/Footer";
import FloatingWhatsAppButton from "../components/common/footer/FloatingWhatsAppButton";
import { BRAND } from "../config/brand";
import { persistMarketingAttribution } from "../utils/marketingAttribution";
import AnalyticsTracker from "../components/common/AnalyticsTracker";
import CookieConsent from "../components/common/CookieConsent";
import SeoHead from "../components/common/SeoHead";
import Loader from "../components/common/Loader";
import TourHeader from "../components/tours/tourPage/TourHeader";

const PublicLayout = () => {
  const location = useLocation();
  const isCheckoutRoute = /^(\/booking\/|\/payment\/checkout\/|\/payment-(success|failure|processing)(?:\/|$)|\/payment-status\/)/.test(
    location.pathname
  );
  // The tour page has its own header (desktop) and mobile header.
  const isTourRoute = /^\/tours\/[^/]+\/?$/.test(location.pathname);
  // Checkout and the payment page have their own minimal header and no site navigation, footer or floating WhatsApp button.
  const isTourCheckout = /^\/booking\/[^/]+\/?$/.test(location.pathname) || /^\/payment-processing\/?$/.test(location.pathname);
  // The booking confirmation has its own light header (Tours, My booking).
  const isConfirmedRoute = /^\/booking\/confirmed\/[^/]+\/?$/.test(location.pathname);
  // The home page has its own utility bar and header.
  const isHomeRoute = location.pathname === "/";
  const noIndexRoute = isCheckoutRoute || /^(\/booking-confirmation\/|\/my-booking(?:\/|$)|\/invoice\/|\/login$|\/agent-register$)/.test(location.pathname);

  useEffect(() => {
    persistMarketingAttribution(location.search);
  }, [location.search]);

  return (
    <div className={`app-shell ${isCheckoutRoute ? "is-checkout-route" : ""}`.trim()}>
      <AnalyticsTracker />
      {noIndexRoute ? <SeoHead noIndex title={BRAND.name} description="Secure booking account and payment page." /> : null}
      {isTourRoute ? <div className="tp-header-slot"><TourHeader /></div> : null}
      {isTourRoute || isTourCheckout || isConfirmedRoute || isHomeRoute ? null : <Navbar expand="lg" className="public-nav py-3">
        <Container>
          <Navbar.Brand as={Link} to="/" className="brand-mark fs-4">
            {BRAND.name}
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
      </Navbar>}

      <main className="app-main-content">
        {/* Checkout and payment pages load on first visit; the header and footer stay while they do. */}
        <Suspense fallback={<Loader message="Loading page..." />}>
          <Outlet />
        </Suspense>
      </main>
      {isTourCheckout ? null : <Footer />}
      <CookieConsent />
      {/* The home page has its own WhatsApp button. */}
      {BRAND.whatsappHref && !isTourCheckout && !isConfirmedRoute && !isHomeRoute ? <FloatingWhatsAppButton href={BRAND.whatsappHref} /> : null}
    </div>
  );
};

export default PublicLayout;
