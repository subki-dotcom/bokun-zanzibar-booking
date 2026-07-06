import { Button, Container } from "react-bootstrap";
import { Link } from "react-router-dom";
import { BsArrowRight, BsShieldCheck, BsStarFill, BsWhatsapp } from "react-icons/bs";
import HeroSearchCard from "./HeroSearchCard";

const HeroSection = ({ onSearch }) => (
  <section className="z-home-hero">
    <Container>
      <div className="z-home-hero-panel">
        <div className="z-home-hero-content">
          <div className="z-home-hero-kicker">Riser Tours & Safaris Zanzibar</div>
          <h1>Book Zanzibar tours with local experts.</h1>
          <p>Curated island tours, transfers, safaris, and activities with live availability and secure checkout.</p>

          <div className="z-home-hero-actions">
            <Button as={Link} to="/tours" className="premium-btn text-white">
              Explore tours
              <BsArrowRight />
            </Button>
            <Button
              as="a"
              href="https://wa.me/255778775044"
              target="_blank"
              rel="noreferrer"
              variant="outline-light"
            >
              <BsWhatsapp />
              WhatsApp
            </Button>
          </div>

          <div className="z-home-hero-trust">
            <span>
              <BsStarFill />
              Top-rated experiences
            </span>
            <span>
              <BsShieldCheck />
              Secure booking
            </span>
          </div>
        </div>
      </div>

      <div className="z-home-hero-search-wrap">
        <HeroSearchCard onSearch={onSearch} />
      </div>
    </Container>
  </section>
);

export default HeroSection;
