import { Link } from "react-router-dom";
import { openCookiePreferences } from "../../../utils/consent";

const FooterBottom = () => (
  <section className="premium-footer-bottom">
    <p>(c) {new Date().getFullYear()} Riser Tours & Safaris Zanzibar. All rights reserved.</p>
    <div className="premium-footer-bottom-links">
      <Link to="/privacy">Privacy</Link>
      <button type="button" className="cookie-preferences-link" onClick={openCookiePreferences}>Cookie Preferences</button>
      <Link to="/terms">Terms</Link>
      <a href="mailto:info@risertoursandsafaris.co.tz">Support</a>
    </div>
  </section>
);

export default FooterBottom;
