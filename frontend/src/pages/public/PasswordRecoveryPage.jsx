import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Container, Form } from "react-bootstrap";
import { Link } from "react-router-dom";
import { requestPasswordReset, resetPassword } from "../../api/authApi";
import SeoHead from "../../components/common/SeoHead";

export default function PasswordRecoveryPage({ mode = "forgot" }) {
  const resetting = mode === "reset";
  const [token] = useState(() => typeof window === "undefined" ? "" :
    new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const validLink = /^[a-f0-9]{64}$/.test(token);

  useEffect(() => {
    // Keep the token only in memory after opening the email link.
    if (resetting && window.location.hash) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [resetting]);

  const submit = async (event) => {
    event.preventDefault();
    if (inFlight.current) return;
    setError("");
    if (resetting && (!validLink || password !== confirmation)) {
      setError(!validLink ? "Open the reset link from your email, or request a new link." : "Passwords do not match.");
      return;
    }
    if (resetting && (password.length < 12 || new TextEncoder().encode(password).length > 72)) {
      setError("Use at least 12 characters. Your password is limited to 72 UTF-8 bytes.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const result = resetting
        ? await resetPassword({ token, password })
        : await requestPasswordReset({ email: email.trim() });
      setMessage(result.message);
      setPassword("");
      setConfirmation("");
    } catch (err) {
      setError(err.message || "Could not complete this request. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Container as="main" className="py-5" style={{ maxWidth: 560 }}>
      <SeoHead noIndex title={`${resetting ? "Reset" : "Forgot"} password | Riser Tours & Safaris`}
        description="Secure account recovery for Riser Tours & Safaris admin and staff." />
      <Card className="surface-card">
        <Card.Body>
          <h1 className="h3">{resetting ? "Set a new password" : "Forgot your password?"}</h1>
          <p>{resetting ? "Choose a new password for your admin or staff account." :
            "Enter the email registered to your Admin / Staff account. We will email you a reset link."}</p>
          {error && <Alert variant="danger" role="alert">{error}</Alert>}
          {message && <Alert variant="success" role="status">{message}</Alert>}
          {resetting && !validLink && <Alert variant="warning">This link is missing or invalid. Request a new link below.</Alert>}
          {!message && (!resetting || validLink) && (
            <Form onSubmit={submit}>
              {resetting ? <>
                <Form.Group controlId="recovery-password" className="mb-3">
                  <Form.Label>New password</Form.Label>
                  <Form.Control type="password" autoComplete="new-password" required minLength={12} maxLength={72}
                    value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy}
                    aria-describedby="recovery-password-help" />
                  <Form.Text id="recovery-password-help">Use at least 12 characters. You can paste a password from your password manager.</Form.Text>
                </Form.Group>
                <Form.Group controlId="recovery-confirm" className="mb-3">
                  <Form.Label>Confirm new password</Form.Label>
                  <Form.Control type="password" autoComplete="new-password" required minLength={12} maxLength={72}
                    value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={busy} />
                </Form.Group>
              </> : <Form.Group controlId="recovery-email" className="mb-3">
                <Form.Label>Account email</Form.Label>
                <Form.Control type="email" autoComplete="email" required maxLength={254}
                  value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
              </Form.Group>}
              <Button type="submit" className="premium-btn text-white w-100" disabled={busy}>
                {busy ? "Please wait..." : resetting ? "Save new password" : "Send reset link"}
              </Button>
            </Form>
          )}
          <div className="d-flex flex-wrap gap-3 mt-3">
            <Link to="/login">Back to login</Link>
            {resetting && !message && <Link to="/forgot-password">Request a new link</Link>}
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
}
