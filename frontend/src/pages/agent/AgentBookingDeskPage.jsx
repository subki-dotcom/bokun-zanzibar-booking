import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Col, Form, Row } from "react-bootstrap";
import { Link } from "react-router-dom";
import { BsArrowRight, BsCalendarCheck, BsSearch } from "react-icons/bs";
import { fetchTours } from "../../api/toursApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import { formatCurrency, toPlainText, truncateText } from "../../utils/formatters";

const PAGE_SIZE = 12;

const AgentBookingDeskPage = ({ mode = "desk" }) => {
  const [tours, setTours] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadTours = async (page = 1) => {
    try {
      setLoading(true);
      setError("");
      const result = await fetchTours({ page, limit: PAGE_SIZE });
      setTours(result.items || []);
      setPagination(result.pagination || { page, totalPages: 1 });
    } catch (err) {
      setError(err.message || "Failed to load booking desk tours");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTours(1);
  }, []);

  const filteredTours = useMemo(() => {
    const token = query.trim().toLowerCase();
    if (!token) {
      return tours;
    }

    return tours.filter((tour) =>
      [tour.title, tour.destination, tour.shortDescription, tour.description]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(token))
    );
  }, [query, tours]);

  return (
    <>
      <div className="agent-booking-desk-head">
        <div>
          <h2 className="mb-1">{mode === "products" ? "Products / Tours" : mode === "new-booking" ? "New Booking" : "Booking Desk"}</h2>
          <p className="section-subtitle mb-0">
            {mode === "products"
              ? "Browse Bókun tours, options, live prices, and start an option-level booking."
              : "Create customer bookings as Riser Agent. Payments and commissions stay linked to your agent account."}
          </p>
        </div>
        <Badge bg="success" className="agent-desk-badge">
          Agent bookings
        </Badge>
      </div>

      <Card className="surface-card mb-4">
        <Card.Body>
          <div className="agent-desk-search">
            <BsSearch />
            <Form.Control
              value={query}
              placeholder="Search tour, destination, or activity"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </Card.Body>
      </Card>

      <ErrorAlert error={error} />
      {loading ? <Loader message="Loading booking desk..." /> : null}

      {!loading ? (
        <>
          <Row className="g-4">
            {filteredTours.map((tour) => {
              const image = tour.images?.[0] || "https://images.unsplash.com/photo-1530521954074-e64f6810b32d";
              const summary = truncateText(toPlainText(tour.shortDescription || tour.description || ""), 180);

              return (
                <Col md={6} xl={4} key={tour._id || tour.bokunProductId}>
                  <Card className="surface-card h-100 agent-desk-card">
                    <Card.Img src={image} alt={tour.title} className="legacy-tour-card-image" />
                    <Card.Body>
                      <div className="d-flex justify-content-between gap-3 align-items-start mb-2">
                        <h5 className="tour-card-title mb-0">{tour.title}</h5>
                        <Badge bg="light" text="dark">
                          {formatCurrency(tour.fromPrice || 0, tour.currency || "USD")}
                        </Badge>
                      </div>
                      <p className="section-subtitle tour-card-summary">{summary}</p>
                      <div className="agent-desk-meta">
                        <span>{tour.duration || "Flexible"}</span>
                        <span>{tour.destination || "Zanzibar"}</span>
                      </div>
                      <div className="agent-desk-actions">
                        <Button
                          as={Link}
                          to={`/agent/new-booking/${tour.slug}`}
                          variant="outline-secondary"
                        >
                          View
                        </Button>
                        <Button
                          as={Link}
                          to={`/agent/new-booking/${tour.slug}`}
                          className="premium-btn text-white"
                        >
                          <BsCalendarCheck className="me-2" />
                          Start Booking
                          <BsArrowRight className="ms-2" />
                        </Button>
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              );
            })}
          </Row>

          {!filteredTours.length ? (
            <Card className="surface-card">
              <Card.Body className="text-center text-muted">No tours match your search.</Card.Body>
            </Card>
          ) : null}

          <div className="agent-desk-pagination">
            <Button
              variant="outline-secondary"
              disabled={loading || !pagination.hasPrevPage}
              onClick={() => loadTours(Math.max(1, Number(pagination.page || 1) - 1))}
            >
              Previous
            </Button>
            <span>
              Page {pagination.page || 1} of {pagination.totalPages || 1}
            </span>
            <Button
              variant="outline-secondary"
              disabled={loading || !pagination.hasNextPage}
              onClick={() => loadTours(Number(pagination.page || 1) + 1)}
            >
              Next
            </Button>
          </div>
        </>
      ) : null}
    </>
  );
};

export default AgentBookingDeskPage;
