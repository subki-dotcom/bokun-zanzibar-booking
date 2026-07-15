import { Link } from "react-router-dom";

const FooterBottom = () => (
  <section className="premium-footer-bottom">
    <p>(c) {new Date().getFullYear()} Riser Tours & Safaris Zanzibar. All rights reserved.</p>
    <div className="premium-footer-bottom-links">
      <Link to="/privacy">Privacy</Link>
      <Link to="/terms">Terms</Link>
      <a href="mailto:info@risertoursandsafaris.co.tz">Support</a>
    </div>
  </section>
);

export default FooterBottom;
