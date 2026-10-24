import { Container } from "react-bootstrap";
import { Link, Navigate, useLocation } from "react-router-dom";
import SeoHead from "../../components/common/SeoHead";
import { BRAND } from "../../config/brand";
import { sitePageFor } from "../../config/sitePages";

// A section is [heading, body] or { heading, body, links }.
const readSection = (section) => (Array.isArray(section) ? { heading: section[0], body: section[1], links: [] } : { links: [], ...section });

// The simple information pages: About, Contact, FAQ, Cancellation policy, Privacy, Terms (text in config/sitePages.js).
const LegalPage = () => {
  const content = sitePageFor(useLocation().pathname);
  if (!content) return <Navigate to="/" replace />;

  return (
    <main className="legal-page py-5">
      <SeoHead title={`${content.title} | ${BRAND.name}`} description={content.description || content.intro} />
      <Container className="legal-page-shell">
        <article className="legal-page-card">
          <h1>{content.title}</h1>
          <p className="legal-page-intro">{content.intro}</p>
          {content.sections.map(readSection).map(({ heading, body, links }) => (
            <section key={heading}>
              <h2>{heading}</h2>
              {body ? <p>{body}</p> : null}
              {links.length ? (
                <ul className="legal-page-links">
                  {links.filter((link) => link.href || link.to).map((link) => (
                    <li key={link.label}>
                      {link.to ? (
                        <Link to={link.to}>{link.label}</Link>
                      ) : (
                        <a href={link.href} {...(link.external ? { target: "_blank", rel: "noreferrer" } : {})}>{link.label}</a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </article>
      </Container>
    </main>
  );
};

export default LegalPage;
