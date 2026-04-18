import { Col, Container, Row } from "react-bootstrap";
import {
  BsChatDots,
  BsCheck2Circle,
  BsCompass,
  BsCreditCard2Front,
  BsGeoAlt,
  BsShieldCheck
} from "react-icons/bs";

const features = [
  {
    title: "Local Zanzibar experts",
    copy: "Deep local destination knowledge with reliable on-ground support.",
    icon: BsGeoAlt
  },
  {
    title: "Easy pickup options",
    copy: "Flexible pickup and meeting points based on the selected experience.",
    icon: BsCompass
  },
  {
    title: "Secure payments",
    copy: "Protected checkout flow with trusted payment methods.",
    icon: BsCreditCard2Front
  },
  {
    title: "Instant confirmation",
    copy: "Receive booking status quickly with live supplier-backed processing.",
    icon: BsCheck2Circle
  },
  {
    title: "Curated quality tours",
    copy: "Carefully selected island and safari experiences for travelers.",
    icon: BsShieldCheck
  },
  {
    title: "Friendly support",
    copy: "Fast responses before, during, and after your booking journey.",
    icon: BsChatDots
  }
];

const WhyBookUsSection = () => (
  <section className="z-home-section z-home-why">
    <Container>
      <div className="z-home-section-head">
        <h2>Why book with us</h2>
        <p>Built for confidence, speed, and premium travel planning in Zanzibar.</p>
      </div>

      <Row className="g-3">
        {features.map((item) => {
          const Icon = item.icon;

          return (
            <Col key={item.title} lg={4} md={6}>
              <article className="z-home-why-card">
                <span className="z-home-why-icon">
                  <Icon />
                </span>
                <h5>{item.title}</h5>
                <p>{item.copy}</p>
              </article>
            </Col>
          );
        })}
      </Row>
    </Container>
  </section>
);

export default WhyBookUsSection;
