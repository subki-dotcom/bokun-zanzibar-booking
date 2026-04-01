import { Container, Row, Col } from "react-bootstrap";
import FooterNewsletter from "./FooterNewsletter";
import FooterTrustStrip from "./FooterTrustStrip";
import FooterBrandSection from "./FooterBrandSection";
import FooterLinksSection from "./FooterLinksSection";
import FooterContactSection from "./FooterContactSection";
import FooterPaymentRow from "./FooterPaymentRow";
import FooterBottom from "./FooterBottom";

const quickLinks = [
  { label: "Home", to: "/" },
  { label: "Tours", to: "/tours" },
  { label: "Transfers", to: "/tours" },
  { label: "My Booking", to: "/my-booking" },
  { label: "Contact Us", to: "/tours" }
];

const topExperiences = [
  { label: "Stone Town Tour", to: "/tours" },
  { label: "Mnemba Island", to: "/tours" },
  { label: "Jozani Forest", to: "/tours" },
  { label: "Prison Island", to: "/tours" },
  { label: "Safari Blue", to: "/tours" }
];

const Footer = () => (
  <footer className="premium-footer">
    <Container>
      <FooterNewsletter />
      <FooterTrustStrip />

      <section className="premium-footer-main">
        <Row className="g-4">
          <Col lg={5} md={6}>
            <FooterBrandSection />
          </Col>
          <Col lg={2} md={6}>
            <FooterLinksSection title="Quick Links" links={quickLinks} />
          </Col>
          <Col lg={2} md={6}>
            <FooterLinksSection title="Top Experiences" links={topExperiences} />
          </Col>
          <Col lg={3} md={6}>
            <FooterContactSection />
          </Col>
        </Row>
      </section>

      <FooterPaymentRow />
      <FooterBottom />
    </Container>
  </footer>
);

export default Footer;
