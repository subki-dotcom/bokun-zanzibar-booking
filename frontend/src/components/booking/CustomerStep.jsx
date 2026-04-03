import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";

const CustomerStep = ({ customer, setCustomer, onBack, onNext }) => {
  const updateCustomer = (field, value) => {
    setCustomer((prev) => ({ ...prev, [field]: value }));
  };

  const isValid = customer.firstName && customer.lastName && customer.email && customer.phone;

  return (
    <Card className="surface-card">
      <Card.Body>
        <h4 className="mb-3">Customer Details</h4>
        <div className="row g-3">
          <div className="col-md-6">
            <Form.Label>First name</Form.Label>
            <Form.Control value={customer.firstName} onChange={(e) => updateCustomer("firstName", e.target.value)} />
          </div>
          <div className="col-md-6">
            <Form.Label>Last name</Form.Label>
            <Form.Control value={customer.lastName} onChange={(e) => updateCustomer("lastName", e.target.value)} />
          </div>
          <div className="col-md-6">
            <Form.Label>Email</Form.Label>
            <Form.Control type="email" value={customer.email} onChange={(e) => updateCustomer("email", e.target.value)} />
          </div>
          <div className="col-md-6">
            <Form.Label>Phone</Form.Label>
            <Form.Control value={customer.phone} onChange={(e) => updateCustomer("phone", e.target.value)} />
          </div>
          <div className="col-md-6">
            <Form.Label>Country</Form.Label>
            <Form.Control value={customer.country} onChange={(e) => updateCustomer("country", e.target.value)} />
          </div>
          <div className="col-md-6">
            <Form.Label>Hotel name</Form.Label>
            <Form.Control value={customer.hotelName} onChange={(e) => updateCustomer("hotelName", e.target.value)} />
          </div>
          <div className="col-12">
            <Form.Label>Notes</Form.Label>
            <Form.Control as="textarea" rows={2} value={customer.notes} onChange={(e) => updateCustomer("notes", e.target.value)} />
          </div>
        </div>

        <div className="checkout-action-row mt-4">
          <Button variant="outline-secondary" onClick={onBack}>
            Back
          </Button>
          <Button className="premium-btn text-white" onClick={onNext} disabled={!isValid}>
            Continue
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default CustomerStep;
