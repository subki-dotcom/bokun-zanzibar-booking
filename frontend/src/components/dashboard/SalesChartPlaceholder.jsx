import Card from "react-bootstrap/Card";

const SalesChartPlaceholder = ({ title = "Monthly Sales Trend" }) => {
  return (
    <Card className="surface-card h-100">
      <Card.Body>
        <h5>{title}</h5>
        <p className="section-subtitle mb-2">Chart-ready area (connect your preferred chart library)</p>
        <div
          style={{
            height: 220,
            borderRadius: 14,
            background:
              "repeating-linear-gradient(90deg, rgba(15,93,107,0.08), rgba(15,93,107,0.08) 28px, transparent 28px, transparent 56px)"
          }}
        />
      </Card.Body>
    </Card>
  );
};

export default SalesChartPlaceholder;