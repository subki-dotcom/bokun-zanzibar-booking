import { Outlet, useLocation } from "react-router-dom";
import { Suspense, useEffect } from "react";
import SiteFooter from "../components/common/siteFooter/SiteFooter";
import FloatingWhatsAppButton from "../components/common/footer/FloatingWhatsAppButton";
import { BRAND } from "../config/brand";
import { persistMarketingAttribution } from "../utils/marketingAttribution";
import AnalyticsTracker from "../components/common/AnalyticsTracker";
import CookieConsent from "../components/common/CookieConsent";
import SeoHead from "../components/common/SeoHead";
import Loader from "../components/common/Loader";
import SiteHeader from "../components/common/siteHeader/SiteHeader";

const PublicLayout = () => {
  const location = useLocation();
  const isCheckoutRoute = /^(\/booking\/|\/payment\/checkout\/|\/payment-(success|failure|processing)(?:\/|$)|\/payment-status\/)/.test(
    location.pathname
  );
  // The tour page keeps its own back/share bar on phones.
  const isTourRoute = /^\/tours\/[^/]+\/?$/.test(location.pathname);
  // Checkout and the payment page show the checkout header themselves (with their step); no floating WhatsApp button.
  const isTourCheckout = /^\/booking\/[^/]+\/?$/.test(location.pathname) || /^\/payment-processing\/?$/.test(location.pathname);
  // The booking confirmation shows the checkout header itself (all steps done).
  const isConfirmedRoute = /^\/booking\/confirmed\/[^/]+\/?$/.test(location.pathname);
  // The home page header sits over the hero photo.
  const isHomeRoute = location.pathname === "/";
  const pageHasHeader = isTourCheckout || isConfirmedRoute;
  // Checkout, payment and confirmation pages get the one-line footer.
  const compactFooter = isCheckoutRoute || isTourCheckout || /^\/booking-confirmation\//.test(location.pathname);
  const noIndexRoute = isCheckoutRoute || /^(\/booking-confirmation\/|\/my-booking(?:\/|$)|\/invoice\/|\/login$|\/agent-register$)/.test(location.pathname);

  useEffect(() => {
    persistMarketingAttribution(location.search);
  }, [location.search]);

  return (
    <div className={`app-shell ${isCheckoutRoute ? "is-checkout-route" : ""}`.trim()}>
      <AnalyticsTracker />
      {noIndexRoute ? <SeoHead noIndex title={BRAND.name} description="Secure booking account and payment page." /> : null}
      {pageHasHeader ? null : isCheckoutRoute ? (
        <SiteHeader variant="checkout" showSteps={false} />
      ) : (
        <div className={isTourRoute ? "sh-slot-tour" : undefined}>
          <SiteHeader variant={isHomeRoute ? "transparent" : "default"} />
        </div>
      )}

      <main className="app-main-content" id="main-content" tabIndex={-1}>
        {/* Checkout and payment pages load on first visit; the header and footer stay while they do. */}
        <Suspense fallback={<Loader message="Loading page..." />}>
          <Outlet />
        </Suspense>
      </main>
      <SiteFooter compact={compactFooter} />
      <CookieConsent />
      {/* The home page has its own WhatsApp button. */}
      {BRAND.whatsappHref && !isTourCheckout && !isConfirmedRoute && !isHomeRoute ? <FloatingWhatsAppButton href={BRAND.whatsappHref} /> : null}
    </div>
  );
};

export default PublicLayout;
