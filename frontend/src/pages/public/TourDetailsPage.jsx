import { useEffect, useState } from "react";
import { Container } from "react-bootstrap";
import { useParams } from "react-router-dom";
import { fetchTourBySlug } from "../../api/toursApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import SingleTourPage from "../../components/tours/single/SingleTourPage";

const TourDetailsPage = () => {
  const { slug } = useParams();
  const [tour, setTour] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const result = await fetchTourBySlug(slug);
        setTour(result);
      } catch (err) {
        setError(err.message || "Failed to load tour details");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [slug]);

  if (loading) {
    return (
      <Container className="py-4">
        <Loader message="Loading tour details..." />
      </Container>
    );
  }

  if (error) {
    return (
      <Container className="py-4">
        <ErrorAlert error={error} />
      </Container>
    );
  }

  return <SingleTourPage tour={tour} />;
};

export default TourDetailsPage;
