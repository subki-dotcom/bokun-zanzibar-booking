import { Container, Row, Col, Button } from "react-bootstrap";
import { Link } from "react-router-dom";

const HomePage = () => {
  return (
    <>
      <section className="hero-band py-5 mb-4">
        <Container>
          <Row className="align-items-center g-4">
            <Col lg={7}>
              <h1 className="display-5 mb-3">Premium Zanzibar Tours, Seamless Live Booking</h1>
              <p className="lead text-white-50">
                Discover ocean adventures, cultural routes, and curated island activities with live Bokun availability,
                pricing, and instant confirmations.
              </p>
              <div className="d-flex flex-wrap gap-2">
                <Button as={Link} to="/tours" className="premium-btn text-white">
                  Explore Tours
                </Button>
                <Button as={Link} to="/my-booking" variant="outline-light">
                  Manage My Booking
                </Button>
              </div>
            </Col>
            <Col lg={5}>
              <img
                src="https://images.unsplash.com/photo-1544551763-46a013bb70d5"
                alt="Zanzibar ocean"
                className="img-fluid rounded-4 shadow"
              />
            </Col>
          </Row>
        </Container>
      </section>

      <Container className="pb-5">
        <Row className="g-4">
          <Col md={4}>
            <div className="surface-card p-4 h-100">
              <h5>Live Availability</h5>
              <p className="section-subtitle mb-0">
                Dates, slots, capacity, and pricing are fetched in real-time from Bokun before booking confirmation.
              </p>
            </div>
          </Col>
          <Col md={4}>
            <div className="surface-card p-4 h-100">
              <h5>Premium Checkout</h5>
              <p className="section-subtitle mb-0">
                Option-level booking flow with smart questions, travel details, and polished conversion-focused UX.
              </p>
            </div>
          </Col>
          <Col md={4}>
            <div className="surface-card p-4 h-100">
              <h5>Agent & Admin Tools</h5>
              <p className="section-subtitle mb-0">
                Dedicated portals for bookings, invoices, commissions, sync management, and operational reporting.
              </p>
            </div>
          </Col>
        </Row>
      </Container>
    </>
  );
};

export default HomePage;