import { useState } from "react";
import { Button, Card, Col, Container, Form, Row } from "react-bootstrap";
import { Link } from "react-router-dom";
import { registerAgent } from "../../api/authApi";
import ErrorAlert from "../../components/common/ErrorAlert";

const AgentRegisterPage = () => {
  const [form, setForm] = useState({
    companyName: "",
    contactFirstName: "",
    contactLastName: "",
    email: "",
    password: "",
    phone: "",
    country: "Tanzania",
    address: "",
    agentType: "hotel",
    notes: ""
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      setError("");
      setSuccess("");
      await registerAgent(form);
      setSuccess("Your agent application has been submitted. Riser admin will review and approve your account.");
    } catch (err) {
      setError(err.message || "Could not submit agent application");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container className="py-5">
      <Row className="justify-content-center">
        <Col lg={8}>
          <Card className="surface-card">
            <Card.Body>
              <h3 className="mb-2">Agent Application</h3>
              <p className="section-subtitle">Apply to sell Riser Tours & Safaris products as a partner agent.</p>
              <ErrorAlert error={error} />
              {success ? <div className="alert alert-success">{success}</div> : null}
              <Form onSubmit={handleSubmit}>
                <Row className="g-3">
                  <Col md={6}><Form.Control placeholder="Company / Hotel Name" value={form.companyName} onChange={(e) => update("companyName", e.target.value)} required /></Col>
                  <Col md={6}><Form.Select value={form.agentType} onChange={(e) => update("agentType", e.target.value)}><option value="hotel">Hotel</option><option value="freelancer">Freelancer</option><option value="tour_agent">Tour Agent</option><option value="partner">Partner</option><option value="other">Other</option></Form.Select></Col>
                  <Col md={6}><Form.Control placeholder="First Name" value={form.contactFirstName} onChange={(e) => update("contactFirstName", e.target.value)} required /></Col>
                  <Col md={6}><Form.Control placeholder="Last Name" value={form.contactLastName} onChange={(e) => update("contactLastName", e.target.value)} required /></Col>
                  <Col md={6}><Form.Control type="email" placeholder="Email" value={form.email} onChange={(e) => update("email", e.target.value)} required /></Col>
                  <Col md={6}><Form.Control type="password" placeholder="Password" value={form.password} onChange={(e) => update("password", e.target.value)} required minLength={8} /></Col>
                  <Col md={6}><Form.Control placeholder="Phone / WhatsApp" value={form.phone} onChange={(e) => update("phone", e.target.value)} /></Col>
                  <Col md={6}><Form.Control placeholder="Country" value={form.country} onChange={(e) => update("country", e.target.value)} /></Col>
                  <Col md={12}><Form.Control placeholder="Address / Location" value={form.address} onChange={(e) => update("address", e.target.value)} /></Col>
                  <Col md={12}><Form.Control as="textarea" rows={3} placeholder="Tell us about your business" value={form.notes} onChange={(e) => update("notes", e.target.value)} /></Col>
                </Row>
                <div className="d-flex flex-wrap gap-2 mt-4">
                  <Button type="submit" className="premium-btn text-white" disabled={loading}>{loading ? "Submitting..." : "Submit Application"}</Button>
                  <Button as={Link} to="/login" variant="outline-secondary">Back to Login</Button>
                </div>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default AgentRegisterPage;
