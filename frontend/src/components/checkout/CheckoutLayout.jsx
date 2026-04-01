import Card from "react-bootstrap/Card";

const CheckoutLayout = ({ title, subtitle, children }) => {
  return (
    <Card className="surface-card">
      <Card.Body>
        <h3 className="mb-2">{title}</h3>
        {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
        {children}
      </Card.Body>
    </Card>
  );
};

export default CheckoutLayout;