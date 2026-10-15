import { Spinner } from "react-bootstrap";
import { FaArrowRight, FaCarSide, FaCheck, FaClock, FaLocationDot, FaPlaneArrival, FaPlaneDeparture } from "react-icons/fa6";
import { formatUsd } from "../../../utils/transferBooking";

// Inclusions are shown only when staff have switched them on for the route in Transfer Admin.
const INCLUSION_LABELS = Object.freeze({
  PRIVATE_VEHICLE: "Private vehicle",
  PROFESSIONAL_DRIVER: "Professional driver",
  FUEL_INCLUDED: "Fuel included",
  HOTEL_PICKUP: "Hotel pickup",
  HOTEL_DROPOFF: "Hotel drop-off",
  LUGGAGE_ASSISTANCE: "Luggage assistance"
});

// "Approx. 1 h 15 min", only when the route has a duration configured.
export const approxDuration = (minutes) => {
  const total = Number(minutes);
  if (!Number.isFinite(total) || total <= 0) return "";
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return `Approx. ${[hours ? `${hours} h` : "", rest ? `${rest} min` : ""].filter(Boolean).join(" ")}`;
};

const RouteIcon = ({ route }) => {
  if (route.pickup.type === "AIRPORT") return <FaPlaneArrival aria-hidden="true" />;
  if (route.dropoff.type === "AIRPORT") return <FaPlaneDeparture aria-hidden="true" />;
  return <FaCarSide aria-hidden="true" />;
};

const RouteCard = ({ route, onBook }) => {
  const duration = approxDuration(route.durationMinutes);
  const priced = route.price.status === "PRICED";
  const headingId = `popular-route-${route.slug}`;
  return (
    <li className="tw-route-card">
      <article aria-labelledby={headingId}>
        <div className="tw-route-card-head">
          <span className="tw-route-icon"><RouteIcon route={route} /></span>
          <div>
            <h3 id={headingId}>{route.title}</h3>
            <p className="tw-route-type">Private Transfer · One Way</p>
          </div>
        </div>
        <dl className="tw-route-places">
          <div><dt><FaLocationDot aria-hidden="true" /> Pickup</dt><dd>{route.pickup.name}</dd></div>
          <div><dt><FaLocationDot aria-hidden="true" /> Drop-off</dt><dd>{route.dropoff.name}</dd></div>
          {duration ? <div><dt><FaClock aria-hidden="true" /> Duration</dt><dd>{duration}</dd></div> : null}
        </dl>
        {route.inclusions.length ? (
          <ul className="tw-route-inclusions" aria-label="Included">
            {route.inclusions.filter((item) => INCLUSION_LABELS[item]).map((item) => (
              <li key={item}><FaCheck aria-hidden="true" /> {INCLUSION_LABELS[item]}</li>
            ))}
          </ul>
        ) : null}
        <div className="tw-route-foot">
          {priced ? (
            <p className="tw-route-price"><span>From</span> <strong>{formatUsd(route.price.from)}</strong> <small>per vehicle</small></p>
          ) : (
            <p className="tw-route-price"><strong className="tw-route-quote">Price on Request</strong> <small>Our team prices your trip</small></p>
          )}
          <button type="button" className="tw-btn tw-btn-primary tw-route-book" onClick={() => onBook(route)} aria-describedby={headingId}>
            Book Now <FaArrowRight aria-hidden="true" />
          </button>
        </div>
      </article>
    </li>
  );
};

// Popular routes: real products from the Transfer System, each opening the booking widget with its places filled in.
const PopularRoutes = ({ routes, state, onBook }) => {
  if (state === "ready" && !routes.length) return null;
  return (
    <section className="tw-popular" aria-labelledby="popular-routes-heading">
      <header className="tw-popular-head">
        <h2 id="popular-routes-heading">Popular Transfer Routes</h2>
        <p>Book reliable private airport and hotel transfers across Zanzibar.</p>
      </header>
      {state === "loading" ? (
        <div className="tw-loading" role="status"><Spinner animation="border" size="sm" /> Loading popular routes…</div>
      ) : state === "error" ? (
        <p className="tw-summary-muted" role="status">Popular routes are not available right now. You can still book any trip with the search above.</p>
      ) : (
        <ul className="tw-route-grid">
          {routes.map((route) => <RouteCard key={route.slug} route={route} onBook={onBook} />)}
        </ul>
      )}
    </section>
  );
};

export default PopularRoutes;
