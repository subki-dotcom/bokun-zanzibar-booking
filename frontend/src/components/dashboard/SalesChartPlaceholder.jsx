import Card from "react-bootstrap/Card";

const SalesChartPlaceholder = ({ title = "Monthly Sales Trend" }) => {
  return (
    <Card className="surface-card h-100">
      <Card.Body>
        <h5>{title}</h5>
        <p className="section-subtitle mb-2">Chart-ready area (connect your preferred chart library)</p>
        <div className="sales-chart-placeholder" />
      </Card.Body>
    </Card>
  );
};

export default SalesChartPlaceholder;
