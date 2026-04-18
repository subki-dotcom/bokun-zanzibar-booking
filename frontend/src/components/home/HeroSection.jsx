import { Button, Col, Container, Row } from "react-bootstrap";
import { Link } from "react-router-dom";
import { BsShieldCheck, BsStarFill } from "react-icons/bs";
import HeroSearchCard from "./HeroSearchCard";

const HeroSection = ({ onSearch }) => (
  <section className="z-home-hero">
    <Container>
      <Row className="align-items-center g-4">
        <Col lg={7}>
          <div className="z-home-hero-kicker">Premium Zanzibar travel experiences</div>
          <h1>Discover Zanzibar&apos;s Best Tours and Experiences</h1>
          <p>
            Book trusted island adventures, safaris, cultural tours, and transfers with a local expert team.
          </p>

          <div className="z-home-hero-trust">
            <span>
              <BsStarFill />
              Top-rated local experiences
            </span>
            <span>
              <BsShieldCheck />
              Easy booking and secure payment
            </span>
          </div>

          <div className="d-flex flex-wrap gap-2 mt-4">
            <Button as={Link} to="/tours" className="premium-btn text-white">
              Explore tours
            </Button>
            <Button as={Link} to="/tours?q=Transfers" variant="outline-light">
              Book transfer
            </Button>
          </div>
        </Col>

        <Col lg={5}>
          <div className="z-home-hero-visual">
            <img
              src="https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=1500&q=80"
              alt="Ocean view in Zanzibar"
            />
            <div className="z-home-hero-floating">
              <strong>Live Bokun data</strong>
              <span>Availability and pricing updated in real time</span>
            </div>
          </div>
        </Col>
      </Row>

      <div className="z-home-hero-search-wrap">
        <HeroSearchCard onSearch={onSearch} />
      </div>
    </Container>
  </section>
);

export default HeroSection;
