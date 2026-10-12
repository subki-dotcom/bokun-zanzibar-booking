import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, Card, Col, Container, Form, Row } from "react-bootstrap";
import { warmAuthBackend } from "../../../shared/src/api/authApi";
import ErrorAlert from "../../../shared/src/components/common/ErrorAlert";
import useAuth from "../../../shared/src/hooks/useAuth";
import { backOfficeLandingPath, canUseBackOffice } from "../routes/backOfficeAccess";
import { WEBSITE_URL } from "../config/site";

const BackOfficeLoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, logout } = useAuth();

  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [slowServer, setSlowServer] = useState(false);

  useEffect(() => {
    warmAuthBackend();
  }, []);

  const onSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    setSlowServer(false);
    const slowServerTimer = window.setTimeout(() => setSlowServer(true), 7000);

    try {
      const result = await login({ ...form, portal: "admin" });
      if (!canUseBackOffice(result.user?.role)) {
        logout();
        setError("This account cannot use the Back Office. Agents sign in on the website.");
        return;
      }
      // A page the role cannot open bounces to "/", which forwards to the role's landing page.
      navigate(location.state?.from || backOfficeLandingPath(result.user?.role), { replace: true });
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      window.clearTimeout(slowServerTimer);
      setSlowServer(false);
      setLoading(false);
    }
  };

  return (
    <Container className="py-5">
      <Row className="justify-content-center">
        <Col md={7} lg={5}>
          <Card className="surface-card">
            <Card.Body>
              <h3 className="mb-2">Back Office Login</h3>
              <p className="section-subtitle">Admin and staff access</p>

              <ErrorAlert error={error} className="mb-3" />

              <Form onSubmit={onSubmit}>
                <Form.Group className="mb-3" controlId="backoffice-login-email">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    autoComplete="username"
                    value={form.email}
                    onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                    required
                  />
                </Form.Group>

                <Form.Group className="mb-4" controlId="backoffice-login-password">
                  <Form.Label>Password</Form.Label>
                  <Form.Control
                    type="password"
                    autoComplete="current-password"
                    value={form.password}
                    onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                    required
                  />
                </Form.Group>

                <Button type="submit" className="premium-btn text-white w-100" disabled={loading}>
                  {loading ? (slowServer ? "Waking secure server..." : "Signing in...") : "Sign In"}
                </Button>
                {loading && slowServer ? (
                  <p className="text-muted small text-center mt-3 mb-0">
                    The secure API is starting up. Please keep this page open.
                  </p>
                ) : null}
              </Form>
              <div className="text-center mt-3">
                <a href={`${WEBSITE_URL}/forgot-password`}>Forgot password?</a>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default BackOfficeLoginPage;
