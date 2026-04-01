import { BsGeoAlt, BsTelephone, BsEnvelope } from "react-icons/bs";

const contactRows = [
  { icon: BsGeoAlt, label: "Zanzibar, Tanzania" },
  { icon: BsTelephone, label: "+255 777 123 456", href: "tel:+255777123456" },
  { icon: BsEnvelope, label: "info@risertoursandsafaris.co.tz", href: "mailto:info@risertoursandsafaris.co.tz" }
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
