import { Row, Col } from "react-bootstrap";
import { BsShieldCheck, BsGeoAlt, BsLightningCharge, BsCreditCard2Front } from "react-icons/bs";

const TRUST_BADGES = [
  { label: "Secure Bookings", icon: BsShieldCheck },
  { label: "Trusted Local Experience", icon: BsGeoAlt },
  { label: "Fast Confirmation", icon: BsLightningCharge },
  { label: "Safe Online Payments", icon: BsCreditCard2Front }
];

const FooterTrustStrip = () => (
  <section className="premium-footer-trust-strip">
    <Row className="g-3">
      {TRUST_BADGES.map((item) => {
        const Icon = item.icon;
        return (
          <Col xs={12} sm={6} lg={3} key={item.label}>
            <article className="premium-footer-trust-card">
              <span className="premium-footer-trust-icon">
                <Icon />
              </span>
              <strong>{item.label}</strong>
            </article>
          </Col>
        );
      })}
    </Row>
  </section>
);

export default FooterTrustStrip;
