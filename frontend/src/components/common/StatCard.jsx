import Card from "react-bootstrap/Card";

const StatCard = ({ title, value, hint }) => (
  <Card className="metric-card border-0 h-100">
    <Card.Body>
      <small className="text-white-50 d-block mb-2">{title}</small>
      <div className="value">{value}</div>
      {hint ? <small className="text-white-50">{hint}</small> : null}
    </Card.Body>
  </Card>
);

export default StatCard;