import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Form } from "react-bootstrap";
import { useAuth } from "../auth/AuthContext";

const LoginPage = () => {
  const { user, login, sessionMessage } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={location.state?.from || "/"} replace />;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(form);
      navigate(location.state?.from || "/", { replace: true });
    } catch (failure) {
      setError(failure.status === 429 ? "Too many sign-in attempts. Please wait and try again." : failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ta-login">
      <Card className="ta-login-card">
        <Card.Body>
          <div className="ta-brand ta-brand-login">
            <span className="ta-brand-mark" aria-hidden="true">T</span>
            <div>
              <strong>Transfer Admin</strong>
              <span>Riser Transfers</span>
            </div>
          </div>
          <h1 className="h4 mb-3">Sign in</h1>
          {sessionMessage ? <Alert variant="info">{sessionMessage}</Alert> : null}
          {error ? <Alert variant="danger" role="alert">{error}</Alert> : null}
          <Form onSubmit={submit}>
            <Form.Group className="mb-3" controlId="ta-login-email">
              <Form.Label>Email</Form.Label>
              <Form.Control type="email" autoComplete="username" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
            </Form.Group>
            <Form.Group className="mb-4" controlId="ta-login-password">
              <Form.Label>Password</Form.Label>
              <Form.Control type="password" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
            </Form.Group>
            <Button type="submit" className="w-100" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          </Form>
          <p className="ta-login-note">Transfer Admin accounts are separate from the Back Office and the agent portal. Forgotten passwords are reset by a transfer admin.</p>
        </Card.Body>
      </Card>
    </div>
  );
};

export default LoginPage;
