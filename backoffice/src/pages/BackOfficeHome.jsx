import { Navigate } from "react-router-dom";
import { Button, Card, Col, Container, Row } from "react-bootstrap";
import Loader from "../../../shared/src/components/common/Loader";
import useAuth from "../../../shared/src/hooks/useAuth";
import { backOfficeEntry, backOfficeLandingPath } from "../routes/backOfficeAccess";
import { WEBSITE_URL } from "../config/site";

const BackOfficeHome = () => {
  const { isAuthenticated, user, loading, logout } = useAuth();
  const entry = backOfficeEntry({ loading, isAuthenticated, role: user?.role });

  if (entry === "loading") return <Loader message="Loading session..." />;
  if (entry === "login") return <Navigate to="/login" replace />;
  if (entry === "admin") return <Navigate to={backOfficeLandingPath(user?.role)} replace />;

  return (
    <Container className="py-5">
      <Row className="justify-content-center">
        <Col md={7} lg={5}>
          <Card className="surface-card">
            <Card.Body>
              <h3 className="mb-2">No Back Office access</h3>
              <p className="section-subtitle">
                This account cannot use the Back Office. Agents sign in on the website.
              </p>
              <div className="d-flex gap-2">
                <Button variant="outline-secondary" onClick={logout}>Sign out</Button>
                <Button as="a" href={`${WEBSITE_URL}/login`} className="premium-btn text-white">Go to the website</Button>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default BackOfficeHome;
