import { Container } from "react-bootstrap";
import { Link } from "react-router-dom";
import SeoHead from "../../components/common/SeoHead";
import { BRAND } from "../../config/brand";

// Any address the site does not have: says so (and asks search engines not to index it) instead of showing the home
// page under a wrong address.
const NotFoundPage = () => (
  <main className="legal-page py-5">
    <SeoHead title={`Page not found | ${BRAND.name}`} description="This page does not exist." noIndex />
    <Container className="legal-page-shell">
      <article className="legal-page-card">
        <h1>Page not found</h1>
        <p className="legal-page-intro">The page you were looking for has moved or does not exist.</p>
        <ul className="legal-page-links">
          <li><Link to="/tours">Browse Zanzibar tours</Link></li>
          <li><Link to="/">Go to the home page</Link></li>
          <li><Link to="/contact">Contact us</Link></li>
        </ul>
      </article>
    </Container>
  </main>
);

export default NotFoundPage;
