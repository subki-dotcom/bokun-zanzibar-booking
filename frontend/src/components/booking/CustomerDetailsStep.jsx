import Card from "react-bootstrap/Card";
import CustomerStep from "./CustomerStep";

const CustomerDetailsStep = ({ customer, setCustomer, onBack, onNext }) => (
  <div>
    <Card className="surface-card smart-step-card mb-3">
      <Card.Body>
        <h4 className="mb-1">Customer details</h4>
        <p className="text-muted mb-0">
          Enter lead traveler information used for confirmation and invoice.
        </p>
      </Card.Body>
    </Card>

    <CustomerStep customer={customer} setCustomer={setCustomer} onBack={onBack} onNext={onNext} />
  </div>
);

export default CustomerDetailsStep;

