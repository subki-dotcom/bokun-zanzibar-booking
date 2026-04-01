import { BsWhatsapp } from "react-icons/bs";

const FloatingWhatsAppButton = ({ href = "https://wa.me/255777123456" }) => (
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
