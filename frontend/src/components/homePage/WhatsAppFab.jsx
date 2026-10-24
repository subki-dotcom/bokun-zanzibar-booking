import { useEffect, useState } from "react";
import { BsWhatsapp } from "react-icons/bs";
import { BRAND } from "../../config/brand";
import { whatsappPlanHref } from "./homeData";

// 56px WhatsApp button. It steps aside while the footer (which has its own WhatsApp button) is on screen, so it
// never sits on top of its buttons.
const WhatsAppFab = () => {
  const [hidden, setHidden] = useState(false);
  const href = whatsappPlanHref(BRAND.whatsappHref, BRAND.name);

  useEffect(() => {
    const targets = [document.querySelector("footer")].filter(Boolean);
    if (!targets.length || typeof IntersectionObserver === "undefined") return undefined;
    const visible = new Set();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => (entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target)));
      setHidden(visible.size > 0);
    }, { threshold: 0.1 });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  if (!href) return null;
  return (
    <a
      href={href}
      className={`hp-fab ${hidden ? "is-hidden" : ""}`}
      target="_blank"
      rel="noreferrer"
      aria-label="Chat with us on WhatsApp"
      tabIndex={hidden ? -1 : undefined}
      aria-hidden={hidden || undefined}
    >
      <BsWhatsapp aria-hidden="true" />
    </a>
  );
};

export default WhatsAppFab;
