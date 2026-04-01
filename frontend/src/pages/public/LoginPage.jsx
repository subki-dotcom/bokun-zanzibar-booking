import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Container, Row, Col, Card, Form, Button } from "react-bootstrap";
import ErrorAlert from "../../components/common/ErrorAlert";
import useAuth from "../../hooks/useAuth";

const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const [form, setForm] = useState({
    email: "",
    password: "",
    portal: "admin"
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await login(form);
      const fallback = result.user.role === "agent" ? "/agent" : "/admin";
      navigate(location.state?.from || fallback, { replace: true });
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container className="py-5">
      <Row className="justify-content-center">
        <Col md={7} lg={5}>
          <Card className="surface-card">
            <Card.Body>
              <h3 className="mb-2">Portal Login</h3>
              <p className="section-subtitle">Admin, staff, and agent access</p>

              <ErrorAlert error={error} className="mb-3" />

              <Form onSubmit={onSubmit}>
                <Form.Group className="mb-3">
                  <Form.Label>Portal</Form.Label>
                  <Form.Select
                    value={form.portal}
                    onChange={(event) => setForm((prev) => ({ ...prev, portal: event.target.value }))}
                  >
                    <option value="admin">Admin / Staff</option>
                    <option value="agent">Agent</option>
                  </Form.Select>
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                    required
                  />
                </Form.Group>

                <Form.Group className="mb-4">
                  <Form.Label>Password</Form.Label>
                  <Form.Control
                    type="password"
                    value={form.password}
                    onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                    required
                  />
                </Form.Group>

                <Button type="submit" className="premium-btn text-white w-100" disabled={loading}>
                  {loading ? "Signing in..." : "Sign In"}
                </Button>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default LoginPage;