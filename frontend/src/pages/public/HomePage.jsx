import { Container, Row, Col, Button } from "react-bootstrap";
import { Link } from "react-router-dom";
import {
  BsCalendarCheck,
  BsClockHistory,
  BsCreditCard2Front,
  BsGeoAlt,
  BsPeople,
  BsShieldCheck,
  BsStarFill
} from "react-icons/bs";

const HomePage = () => {
  return (
    <>
      <section className="hero-band home-hero py-5 mb-4">
        <Container>
          <Row className="align-items-center g-4">
            <Col lg={7}>
              <div className="home-hero-kicker">Bokun-powered Zanzibar marketplace</div>
              <h1 className="display-5 mb-3">Book premium Zanzibar experiences in minutes</h1>
              <p className="lead text-white-50 mb-4">
                Discover handpicked tours, transfers, and activities with live availability, secure checkout, and
                instant booking confirmation.
              </p>

              <div className="home-hero-trust">
                <span>
                  <BsStarFill />
                  Trusted local operators
                </span>
                <span>
                  <BsClockHistory />
                  Fast booking confirmation
                </span>
                <span>
                  <BsShieldCheck />
                  Secure payment flow
                </span>
              </div>

              <div className="d-flex flex-wrap gap-2 mt-4">
                <Button as={Link} to="/tours" className="premium-btn text-white">
                  Explore experiences
                </Button>
                <Button as={Link} to="/my-booking" variant="outline-light">
                  Manage my booking
                </Button>
              </div>

              <div className="home-hero-metrics mt-4">
                <div className="home-hero-metric">
                  <strong>Live</strong>
                  <span>Availability & pricing</span>
                </div>
                <div className="home-hero-metric">
                  <strong>Option-level</strong>
                  <span>Flexible booking setup</span>
                </div>
                <div className="home-hero-metric">
                  <strong>24/7</strong>
                  <span>Booking access online</span>
                </div>
              </div>
            </Col>
            <Col lg={5}>
              <div className="home-hero-visual">
                <img
                  src="https://images.unsplash.com/photo-1544551763-46a013bb70d5"
                  alt="Zanzibar ocean"
                  className="home-hero-main-image"
                />
                <div className="home-hero-float-card">
                  <div>
                    <BsCalendarCheck />
                    <span>Live slots updated</span>
                  </div>
                  <strong>Today</strong>
                </div>
                <div className="home-hero-float-card is-bottom">
                  <div>
                    <BsPeople />
                    <span>Easy group bookings</span>
                  </div>
                  <strong>Fast checkout</strong>
                </div>
              </div>
            </Col>
          </Row>
        </Container>
      </section>

      <Container className="pb-3">
        <section className="home-feature-strip">
          <div className="home-feature-pill">
            <BsCalendarCheck />
            <span>Live Bokun availability</span>
          </div>
          <div className="home-feature-pill">
            <BsCreditCard2Front />
            <span>Secure online payments</span>
          </div>
          <div className="home-feature-pill">
            <BsGeoAlt />
            <span>Zanzibar local experts</span>
          </div>
          <div className="home-feature-pill">
            <BsShieldCheck />
            <span>Reliable booking support</span>
          </div>
        </section>
      </Container>

      <Container className="pb-5">
        <section className="home-section-head mb-3">
          <h2>Why travelers book with us</h2>
          <p>Premium discovery and checkout experience connected to live supplier data.</p>
        </section>

        <Row className="g-4">
          <Col md={4}>
            <div className="surface-card p-4 h-100">
              <h5>Live availability</h5>
              <p className="section-subtitle mb-0">
                Dates, slots, capacity, and pricing are fetched in real-time from Bokun before booking confirmation.
              </p>
            </div>
          </Col>
          <Col md={4}>
            <div className="surface-card p-4 h-100">
              <h5>Premium checkout</h5>
              <p className="section-subtitle mb-0">
                Option-level booking flow with smart questions, travel details, and polished conversion-focused UX.
              </p>
            </div>
          </Col>
          <Col md={4}>
            <div className="surface-card p-4 h-100">
              <h5>Agent and admin tools</h5>
              <p className="section-subtitle mb-0">
                Dedicated portals for bookings, invoices, commissions, sync management, and operational reporting.
              </p>
            </div>
          </Col>
        </Row>

        <section className="home-popular-block mt-5">
          <section className="home-section-head mb-3">
            <h2>Popular Zanzibar experiences</h2>
            <p>Start with high-demand categories and discover your perfect itinerary.</p>
          </section>

          <Row className="g-3">
            <Col lg={4} md={6}>
              <article className="home-popular-card">
                <h5>Ocean & island tours</h5>
                <p>Mnemba snorkeling, sandbank escapes, and full-day sea adventures.</p>
                <Button as={Link} to="/tours" variant="outline-light" size="sm">
                  View tours
                </Button>
              </article>
            </Col>
            <Col lg={4} md={6}>
              <article className="home-popular-card is-alt">
                <h5>Stone Town culture</h5>
                <p>Heritage streets, markets, food stories, and guided history walks.</p>
                <Button as={Link} to="/tours" variant="outline-light" size="sm">
                  Explore culture
                </Button>
              </article>
            </Col>
            <Col lg={4} md={12}>
              <article className="home-popular-card is-warm">
                <h5>Nature & wildlife</h5>
                <p>Jozani forest, Prison Island tortoises, and scenic nature experiences.</p>
                <Button as={Link} to="/tours" variant="outline-light" size="sm">
                  Discover nature
                </Button>
              </article>
            </Col>
          </Row>
        </section>

        <section className="home-how-it-works mt-5">
          <section className="home-section-head mb-3">
            <h2>How booking works</h2>
            <p>Designed for speed, clarity, and confidence from start to confirmation.</p>
          </section>

          <div className="home-steps-grid">
            <div className="home-step-card">
              <span>1</span>
              <h6>Choose your experience</h6>
              <p>Browse tours and select your preferred option and travel date.</p>
            </div>
            <div className="home-step-card">
              <span>2</span>
              <h6>Check live availability</h6>
              <p>Get real-time prices and departure slots directly from Bokun.</p>
            </div>
            <div className="home-step-card">
              <span>3</span>
              <h6>Confirm booking quickly</h6>
              <p>Complete checkout and receive confirmation details immediately.</p>
            </div>
          </div>
        </section>

        <section className="home-final-cta mt-5">
          <div>
            <h3>Ready to plan your Zanzibar trip?</h3>
            <p>Book faster with live availability and premium checkout experience.</p>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <Button as={Link} to="/tours" className="premium-btn text-white">
              Start booking now
            </Button>
            <Button as={Link} to="/my-booking" variant="outline-secondary">
              View my booking
            </Button>
          </div>
        </section>
      </Container>
    </>
  );
};

export default HomePage;
