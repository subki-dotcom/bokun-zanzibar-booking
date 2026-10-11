import { useEffect, useState } from "react";
import { Alert, Button, Card, Form } from "react-bootstrap";
import { fetchSettings, updateSettings } from "../api/transferAdminApi";
import { useAuth } from "../auth/AuthContext";
import { ErrorMessage, Loading, PageHeader, useResource } from "../components/ui";
import { P, can } from "../lib/permissions";

const SettingsPage = () => {
  const { user } = useAuth();
  const manage = can(user, P.PRICING_MANAGE);
  const { data, loading, error, reload } = useResource(() => fetchSettings(), []);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (data) setForm({ infantPricing: data.infantPricing, maxAdvanceDays: data.maxAdvanceDays, reason: "" });
  }, [data]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await updateSettings({ infantPricing: form.infantPricing, maxAdvanceDays: Number(form.maxAdvanceDays), reason: form.reason || undefined });
      setSaved(true);
      await reload();
    } catch (failure) {
      setSaveError(failure);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Booking settings" subtitle="Rules applied to every quote and booking." />
      <ErrorMessage error={error} onRetry={reload} />
      {loading && !form ? <Loading /> : null}
      {form ? (
        <Card className="ta-card" style={{ maxWidth: 640 }}>
          <Card.Body>
            <Form onSubmit={submit}>
              <fieldset disabled={!manage}>
                <Form.Group className="mb-3" controlId="settings-infants">
                  <Form.Label>Infants (0–3 years) in the price tier</Form.Label>
                  <Form.Select value={form.infantPricing} onChange={(event) => setForm({ ...form, infantPricing: event.target.value })}>
                    <option value="EXCLUDED">Not counted (default)</option>
                    <option value="COUNTED">Counted like children</option>
                  </Form.Select>
                  <Form.Text>Infants always count toward vehicle seats.</Form.Text>
                </Form.Group>
                <Form.Group className="mb-3" controlId="settings-horizon">
                  <Form.Label>How far ahead customers can book (days)</Form.Label>
                  <Form.Control type="number" min={1} max={3650} value={form.maxAdvanceDays} onChange={(event) => setForm({ ...form, maxAdvanceDays: event.target.value })} required />
                  <Form.Text>Default 730 days (two years).</Form.Text>
                </Form.Group>
                <Form.Group className="mb-3" controlId="settings-reason">
                  <Form.Label>Reason for the change (optional)</Form.Label>
                  <Form.Control value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} maxLength={500} />
                </Form.Group>
              </fieldset>
              {saved ? <Alert variant="success">Settings saved.</Alert> : null}
              <ErrorMessage error={saveError} />
              {manage ? <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button> : <p className="small text-muted mb-0">Only transfer admins can change these settings.</p>}
            </Form>
          </Card.Body>
        </Card>
      ) : null}
    </>
  );
};

export default SettingsPage;
