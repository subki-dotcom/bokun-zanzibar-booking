import Card from "react-bootstrap/Card";

const TourHighlights = ({ highlights = [] }) => (
  <Card className="surface-card h-100">
    <Card.Body>
      <h5 className="mb-3">Highlights</h5>
      <ul className="mb-0 ps-3">
        {highlights.map((item) => (
          <li key={item} className="mb-2">
            {item}
          </li>
        ))}
      </ul>
    </Card.Body>
  </Card>
);

export default TourHighlights;