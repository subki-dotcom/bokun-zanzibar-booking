import { useEffect, useState } from "react";
import { Container } from "react-bootstrap";
import { useParams } from "react-router-dom";
import { fetchTourBySlug } from "../../api/toursApi";
import TourLoadingSkeleton from "../../components/tours/single/TourLoadingSkeleton";
import ErrorAlert from "../../components/common/ErrorAlert";
import SingleTourPage from "../../components/tours/single/SingleTourPage";
import SeoHead from "../../components/common/SeoHead";
import { BRAND } from "../../config/brand";

// The build writes each tour into its own page (script#riser-prerender-tour). Use it at once on a direct visit,
// then refresh from the API in the background.
const readPrerenderedTour = (slug) => {
  if (typeof document === "undefined") return null;
  try {
    const node = document.getElementById("riser-prerender-tour");
    const tour = node ? JSON.parse(node.textContent || "null") : null;
    return tour && tour.slug === slug ? tour : null;
  } catch {
    return null;
  }
};

const TourDetailsPage = () => {
  const { slug } = useParams();
  const [tour, setTour] = useState(() => readPrerenderedTour(slug));
  const [loading, setLoading] = useState(() => !readPrerenderedTour(slug));
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const prerendered = readPrerenderedTour(slug);
    if (prerendered) {
      setTour(prerendered);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError("");

    fetchTourBySlug(slug)
      .then((result) => {
        if (active) setTour(result);
      })
      .catch((err) => {
        // With the prerendered tour on screen, a failed refresh is not shown as an error.
        if (active && !prerendered) setError(err.message || "Failed to load tour details");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug]);

  if (loading) {
    return <TourLoadingSkeleton />;
  }

  if (error) {
    return (
      <Container className="py-4">
        <SeoHead title={`Tour Not Found | ${BRAND.name}`} description="This tour is unavailable." noIndex />
        <ErrorAlert error={error} />
      </Container>
    );
  }

  const imageValue = Array.isArray(tour?.images) ? tour.images[0] : "";
  const image = typeof imageValue === "string" ? imageValue : imageValue?.url || imageValue?.thumbnailUrl || "";

  return <>
    <SeoHead
      title={`${tour?.title || "Zanzibar Tour"} | ${BRAND.name}`}
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
