import { Link } from "react-router-dom";

const FooterLinksSection = ({ title = "", links = [] }) => (
  <section className="premium-footer-links">
    <h5>{title}</h5>
    <ul>
      {links.map((item) => (
        <li key={item.label}>
          {item.external ? (
            <a href={item.to} target="_blank" rel="noreferrer">
              {item.label}
            </a>
          ) : (
            <Link to={item.to}>{item.label}</Link>
          )}
        </li>
      ))}
    </ul>
  </section>
);

export default FooterLinksSection;
