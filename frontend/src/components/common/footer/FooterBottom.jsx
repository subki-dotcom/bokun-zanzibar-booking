import { Link } from "react-router-dom";

const FooterBottom = () => (
  <section className="premium-footer-bottom">
    <p>(c) {new Date().getFullYear()} Riser Tours & Safaris Zanzibar. All rights reserved.</p>
    <div className="premium-footer-bottom-links">
      <Link to="/tours">Privacy</Link>
      <Link to="/tours">Terms</Link>
      <Link to="/my-booking">Support</Link>
    </div>
  </section>
);

export default FooterBottom;
