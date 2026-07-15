import { BsWhatsapp } from "react-icons/bs";
import { BRAND } from "../../../config/brand";

const FloatingWhatsAppButton = ({ href = BRAND.whatsappHref }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="floating-whatsapp-btn"
    aria-label="Chat on WhatsApp"
  >
    <BsWhatsapp />
  </a>
);

export default FloatingWhatsAppButton;
