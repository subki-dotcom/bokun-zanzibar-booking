import { BsFacebook, BsInstagram, BsTiktok, BsYoutube } from "react-icons/bs";

const socialLinks = [
  { label: "Facebook", href: "#", icon: BsFacebook },
  { label: "Instagram", href: "#", icon: BsInstagram },
  { label: "TikTok", href: "#", icon: BsTiktok },
  { label: "YouTube", href: "#", icon: BsYoutube }
];

const FooterBrandSection = () => (
  <section className="premium-footer-brand">
    <h4>Riser Tours & Safaris Zanzibar</h4>
    <p>
      Explore Zanzibar with handpicked tours, reliable transfers, and premium local experiences.
      From Stone Town to Mnemba, Jozani, Prison Island, and unforgettable safaris, we help
      travelers book with confidence.
    </p>

    <div className="premium-footer-socials">
      {socialLinks.map((item) => {
        const Icon = item.icon;
        return (
          <a
            key={item.label}
            href={item.href}
            target="_blank"
            rel="noreferrer"
            aria-label={item.label}
            className="premium-footer-social-btn"
          >
            <Icon />
          </a>
        );
      })}
    </div>
  </section>
);

export default FooterBrandSection;
