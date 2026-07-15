import { BsFacebook, BsInstagram, BsTiktok, BsYoutube } from "react-icons/bs";
import { BRAND } from "../../../config/brand";

const socialLinks = [
  { label: "Facebook", href: BRAND.social.facebook, icon: BsFacebook },
  { label: "Instagram", href: BRAND.social.instagram, icon: BsInstagram },
  { label: "TikTok", href: BRAND.social.tiktok, icon: BsTiktok },
  { label: "YouTube", href: BRAND.social.youtube, icon: BsYoutube }
].filter((item) => item.href);

const FooterBrandSection = () => (
  <section className="premium-footer-brand">
    <h4>Riser Tours & Safaris Zanzibar</h4>
    <p>
      Explore Zanzibar with handpicked tours, reliable transfers, and premium local experiences.
      From Stone Town to Mnemba, Jozani, Prison Island, and unforgettable safaris, we help
      travelers book with confidence.
    </p>

    {socialLinks.length ? <div className="premium-footer-socials">
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
    </div> : null}
  </section>
);

export default FooterBrandSection;
