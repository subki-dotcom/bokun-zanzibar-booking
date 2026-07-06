import { useEffect, useState } from "react";
import { Button, Card, Col, Form, Row } from "react-bootstrap";
import { fetchAgentProfile, updateAgentProfile } from "../../api/agentApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";

const AgentProfilePage = () => {
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setForm(await fetchAgentProfile());
      } catch (err) {
        setError(err.message || "Failed to load profile");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      setForm(await updateAgentProfile(form));
      setSuccess("Profile updated successfully.");
    } catch (err) {
      setError(err.message || "Could not update profile");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader message="Loading profile..." />;

  return (
    <>
      <h2 className="mb-1">Profile</h2>
      <p className="section-subtitle mb-4">Manage your agent contact details.</p>
      <ErrorAlert error={error} />
      {success ? <div className="alert alert-success">{success}</div> : null}
      <Card className="surface-card">
        <Card.Body>
          <Form onSubmit={submit}>
            <Row className="g-3">
              <Col md={6}><Form.Label>Company / Hotel Name</Form.Label><Form.Control value={form.companyName || ""} onChange={(e) => update("companyName", e.target.value)} /></Col>
              <Col md={3}><Form.Label>First Name</Form.Label><Form.Control value={form.contactFirstName || ""} onChange={(e) => update("contactFirstName", e.target.value)} /></Col>
              <Col md={3}><Form.Label>Last Name</Form.Label><Form.Control value={form.contactLastName || ""} onChange={(e) => update("contactLastName", e.target.value)} /></Col>
              <Col md={6}><Form.Label>Email</Form.Label><Form.Control type="email" value={form.email || ""} onChange={(e) => update("email", e.target.value)} /></Col>
              <Col md={6}><Form.Label>Phone / WhatsApp</Form.Label><Form.Control value={form.phone || ""} onChange={(e) => update("phone", e.target.value)} /></Col>
              <Col md={4}><Form.Label>Country</Form.Label><Form.Control value={form.country || ""} onChange={(e) => update("country", e.target.value)} /></Col>
              <Col md={4}><Form.Label>Agent Type</Form.Label><Form.Select value={form.agentType || "partner"} onChange={(e) => update("agentType", e.target.value)}><option value="hotel">Hotel</option><option value="freelancer">Freelancer</option><option value="tour_agent">Tour Agent</option><option value="partner">Partner</option><option value="other">Other</option></Form.Select></Col>
              <Col md={4}><Form.Label>Commission Rate</Form.Label><Form.Control value={`${form.commissionPercent ?? ""}%`} disabled /></Col>
              <Col md={8}><Form.Label>Location / Address</Form.Label><Form.Control value={form.address || ""} onChange={(e) => update("address", e.target.value)} /></Col>
              <Col md={4}><Form.Label>Account Status</Form.Label><Form.Control value={`${form.accountStatus || ""} / ${form.approvalStatus || ""}`} disabled /></Col>
              <Col md={6}><Form.Label>Current Password</Form.Label><Form.Control type="password" value={form.currentPassword || ""} onChange={(e) => update("currentPassword", e.target.value)} /></Col>
              <Col md={6}><Form.Label>New Password</Form.Label><Form.Control type="password" value={form.newPassword || ""} onChange={(e) => update("newPassword", e.target.value)} /></Col>
            </Row>
            <Button type="submit" className="premium-btn text-white mt-4" disabled={saving}>{saving ? "Saving..." : "Save Profile"}</Button>
          </Form>
        </Card.Body>
      </Card>
    </>
  );
};

export default AgentProfilePage;
