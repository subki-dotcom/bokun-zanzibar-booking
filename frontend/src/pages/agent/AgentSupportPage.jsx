import { Button, Card, Col, Row } from "react-bootstrap";
import { BsEnvelope, BsWhatsapp } from "react-icons/bs";

const AgentSupportPage = () => (
  <>
    <h2 className="mb-1">Support</h2>
    <p className="section-subtitle mb-4">Help for bookings, payments, pickup, and Bókun confirmations.</p>
    <Row className="g-4">
      <Col lg={5}>
        <Card className="surface-card">
          <Card.Body>
            <h5>Contact Riser Tours & Safaris</h5>
            <p className="text-muted">Our operations team can help with booking flow, pickup, customer confirmation, and commission questions.</p>
            <div className="agent-desk-actions">
              <Button as="a" href="https://wa.me/255778775044" target="_blank" rel="noreferrer" className="premium-btn text-white">
                <BsWhatsapp className="me-2" /> WhatsApp
              </Button>
              <Button as="a" href="mailto:info@risertoursandsafaris.co.tz" variant="outline-success">
                <BsEnvelope className="me-2" /> Email
              </Button>
            </div>
          </Card.Body>
        </Card>
      </Col>
      <Col lg={7}>
        <Card className="surface-card">
          <Card.Body>
            <h5>Booking Guide</h5>
            <ol className="agent-help-list">
              <li>Select a tour from Products or New Booking.</li>
              <li>Choose the exact Bókun option, date, start time, and travelers.</li>
              <li>Select pickup or meeting point when the product requires it.</li>
              <li>Enter customer details from your own form once.</li>
              <li>Review live price and availability before payment.</li>
              <li>Complete payment so the booking can be confirmed in Bókun.</li>
            </ol>
            <h5 className="mt-4">FAQ</h5>
            <p className="mb-1"><strong>Can I see another agent's booking?</strong></p>
            <p className="text-muted">No. The portal only shows bookings linked to your agent account.</p>
            <p className="mb-1"><strong>Can I edit my commission?</strong></p>
            <p className="text-muted mb-0">No. Commission is set by admin.</p>
          </Card.Body>
        </Card>
      </Col>
    </Row>
  </>
);

export default AgentSupportPage;
