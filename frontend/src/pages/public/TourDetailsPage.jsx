import { useEffect, useState } from "react";
import { Container } from "react-bootstrap";
import { useParams } from "react-router-dom";
import { fetchTourBySlug } from "../../api/toursApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import SingleTourPage from "../../components/tours/single/SingleTourPage";
import SeoHead from "../../components/common/SeoHead";

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

  const imageValue = Array.isArray(tour?.images) ? tour.images[0] : "";
  const image = typeof imageValue === "string" ? imageValue : imageValue?.url || imageValue?.thumbnailUrl || "";

  return <>
    <SeoHead
      title={`${tour?.title || "Zanzibar Tour"} | Riser Tours & Safaris`}
      description={tour?.shortDescription || tour?.description || "Book this Zanzibar experience with live availability."}
      image={image}
      product={{
        name: tour?.title,
        description: tour?.shortDescription || tour?.description,
        image,
        price: tour?.fromPrice,
        currency: tour?.currency
      }}
    />
    <SingleTourPage tour={tour} />
  </>;
};

export default TourDetailsPage;
