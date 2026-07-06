import { useEffect, useState } from "react";
import { Card } from "react-bootstrap";
import { useParams } from "react-router-dom";
import { fetchTourBySlug } from "../../api/toursApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import SingleTourPage from "../../components/tours/single/SingleTourPage";

const AgentTourBookingPage = () => {
  const { slug } = useParams();
  const [tour, setTour] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setError("");
        setLoading(true);
        const result = await fetchTourBySlug(slug);
        setTour(result);
      } catch (err) {
        setError(err.message || "Failed to load agent booking product");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [slug]);

  if (loading) {
    return <Loader message="Loading agent booking flow..." />;
  }

  if (error) {
    return (
      <Card className="surface-card">
        <Card.Body>
          <ErrorAlert error={error} />
        </Card.Body>
      </Card>
    );
  }

  return (
    <SingleTourPage
      tour={tour}
      portal="agent"
      sessionSource="agent_portal"
      checkoutPath={`/agent/new-booking/${tour.slug}/checkout`}
    />
  );
};

export default AgentTourBookingPage;
