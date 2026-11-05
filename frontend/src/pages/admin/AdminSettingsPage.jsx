import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner } from "react-bootstrap";
import { BsArrowClockwise, BsBuilding, BsEnvelope, BsKey, BsPlug } from "react-icons/bs";
import { fetchAdminSettings, sendSettingsTestEmail } from "../../api/adminApi";
import { changePassword } from "../../api/authApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import useAuth from "../../hooks/useAuth";
import { roleLabel } from "../../config/adminNavigation";
import { AdminPage, PageHeader } from "../../components/admin/ui";

const StatusBadge = ({ ok, okText = "Set up", offText = "Not set up" }) => (
  <Badge bg={ok ? "success" : "secondary"}>{ok ? okText : offText}</Badge>
);

const Field = ({ label, value }) => (
  <div className="d-flex justify-content-between gap-3 py-2 border-bottom">
    <span className="text-muted">{label}</span>
    <strong className="text-end text-break">{value || "—"}</strong>
  </div>
);

const SectionTitle = ({ icon: Icon, title, subtitle }) => (
  <div className="d-flex align-items-start gap-2 mb-3">
    <Icon aria-hidden="true" className="mt-1" />
    <div>
      <h2 className="h6 mb-0">{title}</h2>
      {subtitle ? <small className="text-muted">{subtitle}</small> : null}
    </div>
  </div>
);

// Settings → My account: change the password of the signed-in admin.
const PasswordCard = ({ user }) => {
  const empty = { currentPassword: "", newPassword: "", confirmPassword: "" };
  const [form, setForm] = useState(empty);
  const [state, setState] = useState({ busy: false, error: "", done: false });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    if (form.newPassword.length < 8) return setState({ busy: false, error: "The new password needs at least 8 characters.", done: false });
    if (form.newPassword !== form.confirmPassword) return setState({ busy: false, error: "The two new passwords are not the same.", done: false });
    setState({ busy: true, error: "", done: false });
    try {
      await changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      setForm(empty);
      setState({ busy: false, error: "", done: true });
    } catch (error) {
      setState({ busy: false, error: error?.message || "The password could not be changed.", done: false });
    }
  };

  return (
    <Card className="surface-card h-100">
      <Card.Body>
        <SectionTitle icon={BsKey} title="My account" subtitle={`${user?.email || ""} · ${roleLabel(user?.role)}`} />
        <Form onSubmit={submit} noValidate>
          <Form.Group className="mb-2" controlId="settings-current-password">
            <Form.Label>Current password</Form.Label>
            <Form.Control type="password" autoComplete="current-password" value={form.currentPassword} onChange={set("currentPassword")} required />
          </Form.Group>
          <Form.Group className="mb-2" controlId="settings-new-password">
            <Form.Label>New password</Form.Label>
            <Form.Control type="password" autoComplete="new-password" minLength={8} value={form.newPassword} onChange={set("newPassword")} required />
            <Form.Text>At least 8 characters.</Form.Text>
          </Form.Group>
          <Form.Group className="mb-3" controlId="settings-confirm-password">
            <Form.Label>Repeat the new password</Form.Label>
            <Form.Control type="password" autoComplete="new-password" value={form.confirmPassword} onChange={set("confirmPassword")} required />
          </Form.Group>
          {state.error ? <Alert variant="danger" className="py-2">{state.error}</Alert> : null}
          {state.done ? <Alert variant="success" className="py-2">Password changed. Use the new password the next time you sign in.</Alert> : null}
          <Button type="submit" disabled={state.busy || !form.currentPassword || !form.newPassword}>
            {state.busy ? <Spinner size="sm" className="me-2" /> : null}
            Change password
          </Button>
        </Form>
      </Card.Body>
    </Card>
  );
};

const EmailCard = ({ email, user }) => {
  const [state, setState] = useState({ busy: false, error: "", sentTo: "" });
  const test = async () => {
    setState({ busy: true, error: "", sentTo: "" });
    try {
      const result = await sendSettingsTestEmail();
      setState({ busy: false, error: "", sentTo: result?.sentTo || user?.email || "" });
    } catch (error) {
      setState({ busy: false, error: error?.message || "The test email could not be sent.", sentTo: "" });
    }
  };
  const provider = { smtp: "SMTP", resend: "Resend", none: "None" }[email?.provider] || "—";

  return (
    <Card className="surface-card h-100">
      <Card.Body>
        <SectionTitle icon={BsEnvelope} title="Email" subtitle="Booking confirmations, My booking links, invoices and contact messages" />
        <div className="d-flex justify-content-between align-items-center py-2 border-bottom">
          <span className="text-muted">Status</span>
          <StatusBadge ok={email?.ready} okText="Working setup" offText="Not set up" />
        </div>
        <Field label="Sent with" value={email?.provider === "smtp" ? `${provider} (${email?.smtpHost})` : provider} />
        <Field label="Sender" value={email?.from} />
        <Field label="Guests reply to" value={email?.replyTo} />
        <Field label="Contact form messages go to" value={email?.contactInbox} />
        <div className="mt-3">
          <Button variant="outline-primary" onClick={test} disabled={state.busy || !email?.ready}>
            {state.busy ? <Spinner size="sm" className="me-2" /> : null}
            Send me a test email
          </Button>
          {state.sentTo ? <Alert variant="success" className="py-2 mt-2 mb-0">Test email sent to {state.sentTo}. Check the inbox (and Spam).</Alert> : null}
          {state.error ? <Alert variant="danger" className="py-2 mt-2 mb-0">{state.error}</Alert> : null}
        </div>
      </Card.Body>
    </Card>
  );
};

const AdminSettingsPage = () => {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetchAdminSettings());
    } catch (loadError) {
      setError(loadError?.message || "Settings could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const company = data?.company || {};
  const payments = Array.isArray(data?.payments) ? data.payments : [];
  const paymentName = { pesapal: "Pesapal", dpo: "DPO", paypal: "PayPal" };

  return (
    <AdminPage>
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        description="Your account, and how the website is set up."
        actions={
          <Button variant="outline-secondary" onClick={load} disabled={loading}>
            <BsArrowClockwise aria-hidden="true" /> Refresh
          </Button>
        }
      />

      <ErrorAlert error={error} />

      <Row className="g-3">
        <Col lg={6}>
          <PasswordCard user={user} />
        </Col>
        <Col lg={6}>{loading && !data ? <Loader message="Loading settings..." /> : <EmailCard email={data?.email} user={user} />}</Col>
      </Row>

      {data ? (
        <Row className="g-3">
          <Col lg={6}>
            <Card className="surface-card h-100">
              <Card.Body>
                <SectionTitle icon={BsBuilding} title="Company details" subtitle="Shown on invoices, tickets and emails" />
                <Field label="Name" value={company.brandName} />
                <Field label="Legal name" value={company.legalName} />
                <Field label="Address" value={company.address} />
                <Field label="TIN" value={company.taxId} />
                <Field label="Licence" value={company.licence} />
                <Field label="Phone / WhatsApp" value={company.phone} />
                <Field label="Email" value={company.email} />
                <Field label="Website" value={company.website} />
              </Card.Body>
            </Card>
          </Col>
          <Col lg={6}>
            <Card className="surface-card h-100">
              <Card.Body>
                <SectionTitle icon={BsPlug} title="Connections" subtitle="Bókun, payments and the bot check" />
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span className="text-muted">Bókun</span>
                  <StatusBadge ok={data.bokun?.connected} okText="Connected" />
                </div>
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span className="text-muted">Bókun booking import</span>
                  <StatusBadge ok={data.bokun?.confirmedImport} okText="On" offText="Off" />
                </div>
                {payments.map((provider) => (
                  <div key={provider.id} className="d-flex justify-content-between py-2 border-bottom">
                    <span className="text-muted">{paymentName[provider.id] || provider.id}</span>
                    <StatusBadge ok={provider.enabled} okText={provider.mode === "test" ? "Test mode" : "Live"} />
                  </div>
                ))}
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span className="text-muted">Cloudflare bot check (My booking)</span>
                  <StatusBadge ok={data.security?.turnstile} okText="On" offText="Off" />
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      ) : null}

      {data ? (
        <Alert variant="light" className="border mb-0">
          Company details, email and connections are server settings. To change them, edit the variables in{" "}
          <strong>{data.system?.where}</strong> and save; the server restarts by itself.
        </Alert>
      ) : null}
    </AdminPage>
  );
};

export default AdminSettingsPage;
