import { useEffect, useState } from "react";
import { Button, Card, Col, Form, Row } from "react-bootstrap";
import { fetchAgentSettings, updateAgentSettings } from "../../api/agentApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";

const toggles = [
  ["emailNotifications", "Email notifications"],
  ["whatsappNotifications", "WhatsApp notifications"],
  ["bookingNotifications", "Booking confirmation notifications"],
  ["cancellationNotifications", "Booking cancellation notifications"],
  ["statementNotifications", "Commission statement notifications"],
  ["twoFactorEnabled", "Two-factor security"]
];

const AgentSettingsPage = () => {
  const [form, setForm] = useState({ language: "English", currency: "USD" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setForm(await fetchAgentSettings());
      } catch (err) {
        setError(err.message || "Failed to load settings");
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
      setForm(await updateAgentSettings(form));
      setSuccess("Settings updated.");
    } catch (err) {
      setError(err.message || "Could not update settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader message="Loading settings..." />;

  return (
    <>
      <h2 className="mb-1">Settings</h2>
      <p className="section-subtitle mb-4">Notification and portal preferences.</p>
      <ErrorAlert error={error} />
      {success ? <div className="alert alert-success">{success}</div> : null}
      <Card className="surface-card">
        <Card.Body>
          <Form onSubmit={submit}>
            <Row className="g-3">
              <Col md={4}><Form.Label>Language</Form.Label><Form.Select value={form.language || "English"} onChange={(e) => update("language", e.target.value)}><option>English</option><option>Swahili</option></Form.Select></Col>
              <Col md={4}><Form.Label>Currency</Form.Label><Form.Select value={form.currency || "USD"} onChange={(e) => update("currency", e.target.value)}><option>USD</option><option>TZS</option><option>EUR</option><option>GBP</option></Form.Select></Col>
              <Col md={4}><Form.Label>Statement Frequency</Form.Label><Form.Select value={form.statementFrequency || "monthly"} onChange={(e) => update("statementFrequency", e.target.value)}><option value="monthly">Monthly</option><option value="weekly">Weekly</option></Form.Select></Col>
              {toggles.map(([field, label]) => (
                <Col md={6} key={field}>
                  <Form.Check type="switch" label={label} checked={Boolean(form[field])} onChange={(e) => update(field, e.target.checked)} />
                </Col>
              ))}
            </Row>
            <Button type="submit" className="premium-btn text-white mt-4" disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
          </Form>
        </Card.Body>
      </Card>
    </>
  );
};

export default AgentSettingsPage;
