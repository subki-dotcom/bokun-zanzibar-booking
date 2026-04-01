import Card from "react-bootstrap/Card";

const requiredCustomerFields = ["firstName", "lastName", "email", "phone"];

export const isCustomerSummaryValid = (customer = {}) =>
  requiredCustomerFields.every((field) => String(customer?.[field] || "").trim().length > 0);

const CustomerSummaryCard = ({ customer = {} }) => {
  const valid = isCustomerSummaryValid(customer);
  const fullName = `${customer.firstName || ""} ${customer.lastName || ""}`.trim();

  return (
    <Card className="surface-card review-summary-card">
      <Card.Body>
        <div className="review-block-label">Customer Details</div>
        <div className="review-summary-grid">
          <div className="review-summary-item">
            <span>Full name</span>
            <strong>{fullName || "-"}</strong>
          </div>
          <div className="review-summary-item">
            <span>Email</span>
            <strong>{customer.email || "-"}</strong>
          </div>
          <div className="review-summary-item">
            <span>Phone</span>
            <strong>{customer.phone || "-"}</strong>
          </div>
          {customer.hotelName ? (
            <div className="review-summary-item">
              <span>Hotel name</span>
              <strong>{customer.hotelName}</strong>
            </div>
          ) : null}
        </div>

        {!valid ? (
          <div className="review-inline-warning mt-3">
            Please complete full name, email, and phone before confirming.
          </div>
        ) : null}
      </Card.Body>
    </Card>
  );
};

export default CustomerSummaryCard;

