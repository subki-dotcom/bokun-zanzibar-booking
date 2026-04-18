import { Button, Container } from "react-bootstrap";
import { Link } from "react-router-dom";
import { BsStarFill } from "react-icons/bs";
import { formatHomePrice } from "./home.helpers";

const resolveBadge = (index = 0) => {
  if (index === 0) return "Best Seller";
  if (index === 1) return "Top Rated";
  if (index <= 3) return "Popular";
  return "Private";
};

const BestSellersSection = ({ tours = [] }) => (
  <section className="z-home-section z-home-best">
    <Container>
      <div className="z-home-section-head">
        <h2>Best sellers and trending tours</h2>
        <p>Most loved Zanzibar experiences by traveler demand and ratings.</p>
      </div>

      <div className="z-home-best-scroll">
        {(tours || []).map((tour, index) => {
          const detailPath = tour.slug ? `/tours/${tour.slug}` : "/tours";

          return (
            <article key={tour.id || tour.slug || `${tour.title}-${index}`} className="z-home-best-card">
              <img src={tour.image} alt={tour.title} loading="lazy" />
              <span className="z-home-best-badge">{resolveBadge(index)}</span>
              <div className="z-home-best-body">
                <h5>{tour.title}</h5>
                <div className="z-home-best-rating">
                  <BsStarFill />
                  {Number(tour.rating || 0) > 0 ? Number(tour.rating).toFixed(1) : "New"}
                </div>
                <strong>{formatHomePrice(tour)}</strong>
                <Button as={Link} to={detailPath} variant="outline-secondary" size="sm">
                  View tour
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </Container>
  </section>
);

export default BestSellersSection;
