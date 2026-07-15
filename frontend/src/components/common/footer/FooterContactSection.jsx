import { BsGeoAlt, BsTelephone, BsEnvelope } from "react-icons/bs";
import { BRAND } from "../../../config/brand";

const contactRows = [
  { icon: BsGeoAlt, label: BRAND.location },
  { icon: BsTelephone, label: BRAND.phone, href: BRAND.phoneHref },
  { icon: BsEnvelope, label: BRAND.email, href: `mailto:${BRAND.email}` }
];

const FooterContactSection = () => (
  <section className="premium-footer-contact">
    <h5>Contact Info</h5>
    <ul>
      {contactRows.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.label}>
            <span className="premium-footer-contact-icon">
              <Icon />
            </span>
            {item.href ? <a href={item.href}>{item.label}</a> : <span>{item.label}</span>}
          </li>
        );
      })}
    </ul>
  </section>
);

export default FooterContactSection;
